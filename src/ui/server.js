const path = require("path");
const express = require("express");
const { loadSpec } = require("../spec/loadSpec");
const { listOperations, findOperation, pickSuccessStatus, getResponseSchema } = require("../spec/resolveEndpoint");
const { walkSchema } = require("../schema/walkSchema");
const { generateTestScript } = require("../generate/testScript");
const { buildCollection } = require("../generate/collection");
const { exportScripts } = require("../generate/exportScripts");

/**
 * Minimal local web UI so teammates can browse a spec and generate
 * scripts/collections through a form instead of the terminal. Single-user,
 * single-spec-at-a-time: the loaded spec is kept in memory on the server
 * process, not per-browser-session.
 */
function startServer(port) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(express.static(path.join(__dirname, "public")));

  let currentApi = null;

  app.post("/api/load", async (req, res) => {
    try {
      const { spec, headerKey, headerValue } = req.body;
      if (!spec) return res.status(400).json({ error: "Missing spec path or URL." });
      const headers = headerKey ? { [headerKey]: headerValue || "" } : {};
      currentApi = await loadSpec(spec, headers);
      const operations = listOperations(currentApi).map((op) => ({
        ...op,
        autoStatus: (() => {
          const { operation } = findOperation(currentApi, op.path, op.method);
          return pickSuccessStatus(operation);
        })(),
      }));
      res.json({ title: currentApi.info?.title || spec, operations });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/script", (req, res) => {
    try {
      if (!currentApi) return res.status(400).json({ error: "Load a spec first." });
      const { path: apiPath, method, status } = req.body;
      const { operation } = findOperation(currentApi, apiPath, method);
      const statusCode = status ? Number(status) : pickSuccessStatus(operation);
      if (statusCode === undefined) {
        return res.status(400).json({ error: "No 2xx response documented. Provide a status explicitly." });
      }
      const responseSchema = getResponseSchema(operation, statusCode);
      const fields = responseSchema ? walkSchema(responseSchema) : [];
      const script = generateTestScript({ fields, statusCode });
      res.json({ script, statusCode });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/export", (req, res) => {
    try {
      if (!currentApi) return res.status(400).json({ error: "Load a spec first." });
      const { outDir, status, filter } = req.body;
      if (!outDir) return res.status(400).json({ error: "Missing output folder." });
      const result = exportScripts(currentApi, {
        outDir: path.resolve(outDir),
        statusCode: status ? Number(status) : undefined,
        pathFilter: filter ? new RegExp(filter) : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/collection", (req, res) => {
    try {
      if (!currentApi) return res.status(400).json({ error: "Load a spec first." });
      const { outFile, name, status, filter } = req.body;
      if (!outFile) return res.status(400).json({ error: "Missing output file path." });
      const collection = buildCollection(currentApi, {
        statusCode: status ? Number(status) : undefined,
        pathFilter: filter ? new RegExp(filter) : undefined,
        collectionName: name || undefined,
      });
      require("fs").writeFileSync(path.resolve(outFile), JSON.stringify(collection, null, 2), "utf8");
      res.json({ itemCount: collection.item.length, outFile });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return app.listen(port);
}

module.exports = { startServer };
