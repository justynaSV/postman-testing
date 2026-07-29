const fs = require("fs");
const path = require("path");
const { listOperations, findOperation, pickSuccessStatus, getResponseSchema } = require("../spec/resolveEndpoint");
const { walkSchema } = require("../schema/walkSchema");
const { generateTestScript } = require("./testScript");
const { resolveScriptLocation } = require("./naming");

/**
 * Generates one .js test-script file per endpoint, organized into folders
 * that mirror the team's existing Postman collection structure (version /
 * resource-group / one file per method+path), instead of printing every
 * script to the terminal one command at a time.
 *
 * @param {Object} api - dereferenced OpenAPI document
 * @param {Object} options
 * @param {string} options.outDir - root directory to write files into
 * @param {number} [options.statusCode] - force this status code for every endpoint
 *   (default: auto-detect each endpoint's success status)
 * @param {RegExp} [options.pathFilter] - only include paths matching this regex
 * @returns {{
 *   written: Array<{ path: string, method: string, file: string }>,
 *   skipped: Array<{ path: string, method: string, reason: string }>
 * }}
 */
function exportScripts(api, options = {}) {
  const operations = listOperations(api).filter((op) => (options.pathFilter ? options.pathFilter.test(op.path) : true));

  const written = [];
  const skipped = [];

  for (const op of operations) {
    try {
      const { operation } = findOperation(api, op.path, op.method);
      const statusCode = options.statusCode || pickSuccessStatus(operation);
      if (statusCode === undefined) {
        skipped.push({ path: op.path, method: op.method, reason: "no 2xx response documented" });
        continue;
      }

      const responseSchema = getResponseSchema(operation, statusCode);
      const fields = responseSchema ? walkSchema(responseSchema) : [];
      const script = generateTestScript({ fields, statusCode });

      const { folders, fileName } = resolveScriptLocation(op.path, op.method);
      const dir = path.join(options.outDir, ...folders);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, script, "utf8");
      written.push({ path: op.path, method: op.method, file: filePath });
    } catch (err) {
      skipped.push({ path: op.path, method: op.method, reason: err.message });
    }
  }

  return { written, skipped };
}

module.exports = { exportScripts };
