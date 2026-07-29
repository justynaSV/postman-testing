const fs = require("fs");
const path = require("path");
const prompts = require("prompts");
const { loadSpec } = require("./spec/loadSpec");
const { listOperations, findOperation, pickSuccessStatus, getResponseSchema } = require("./spec/resolveEndpoint");
const { walkSchema } = require("./schema/walkSchema");
const { generateTestScript } = require("./generate/testScript");
const { buildCollection } = require("./generate/collection");
const { exportScripts } = require("./generate/exportScripts");
const { listGenerators, buildPreRequestScript } = require("./generate/dataGenerators");

/** Aborts the whole interactive session cleanly on Ctrl+C (prompts default behavior otherwise leaves things hanging). */
const onCancel = () => {
  console.log("\nCancelled.");
  process.exit(0);
};

async function promptSpec() {
  const { spec, needsHeader } = await prompts(
    [
      { type: "text", name: "spec", message: "Path or URL to the OpenAPI/Swagger document", validate: (v) => (v ? true : "Required") },
      { type: "confirm", name: "needsHeader", message: "Does loading this spec require an HTTP header (e.g. Authorization)?", initial: false },
    ],
    { onCancel }
  );

  let headers = {};
  if (needsHeader) {
    const { headerLine } = await prompts(
      { type: "text", name: "headerLine", message: 'Header as "Key: Value"', validate: (v) => (v.includes(":") ? true : 'Expected format "Key: Value"') },
      { onCancel }
    );
    const separatorIndex = headerLine.indexOf(":");
    headers = { [headerLine.slice(0, separatorIndex).trim()]: headerLine.slice(separatorIndex + 1).trim() };
  }

  console.log(`Loading ${spec} ...`);
  const api = await loadSpec(spec, headers);
  console.log(`Loaded "${api.info?.title || spec}" (${listOperations(api).length} operations).`);
  return api;
}

async function promptOperation(api) {
  const operations = listOperations(api);
  const { picked } = await prompts(
    {
      type: "autocomplete",
      name: "picked",
      message: "Pick an endpoint (type to search)",
      choices: operations.map((op) => ({
        title: `${op.method.toUpperCase().padEnd(6)} ${op.path}${op.summary ? "  # " + op.summary : ""}`,
        value: op,
      })),
      suggest: (input, choices) => choices.filter((c) => c.title.toLowerCase().includes(input.toLowerCase())),
    },
    { onCancel }
  );
  return picked;
}

async function runSingleScript(api) {
  const op = await promptOperation(api);
  const { operation } = findOperation(api, op.path, op.method);
  const autoStatus = pickSuccessStatus(operation);

  const { statusCode } = await prompts(
    {
      type: "text",
      name: "statusCode",
      message: "Status code to generate the test for",
      initial: autoStatus !== undefined ? String(autoStatus) : "200",
    },
    { onCancel }
  );

  const responseSchema = getResponseSchema(operation, Number(statusCode));
  const fields = responseSchema ? walkSchema(responseSchema) : [];
  const script = generateTestScript({ fields, statusCode: Number(statusCode) });

  const { destination } = await prompts(
    { type: "select", name: "destination", message: "What should I do with the script?", choices: [
      { title: "Print it here", value: "stdout" },
      { title: "Save it to a file", value: "file" },
    ] },
    { onCancel }
  );

  if (destination === "file") {
    const { outFile } = await prompts(
      { type: "text", name: "outFile", message: "File path to save to", initial: "./script.js" },
      { onCancel }
    );
    fs.writeFileSync(path.resolve(outFile), script, "utf8");
    console.log(`Saved to ${outFile}`);
  } else {
    console.log("\n" + script + "\n");
  }
}

async function runExportAll(api) {
  const { outDir, filter, status } = await prompts(
    [
      { type: "text", name: "outDir", message: "Folder to write all script files into", initial: "./postman-scripts" },
      { type: "text", name: "filter", message: "Only include paths matching this regex (leave blank for all)", initial: "" },
      { type: "text", name: "status", message: "Force a status code for every endpoint (leave blank to auto-detect)", initial: "" },
    ],
    { onCancel }
  );

  const { written, skipped } = exportScripts(api, {
    outDir: path.resolve(outDir),
    statusCode: status ? Number(status) : undefined,
    pathFilter: filter ? new RegExp(filter) : undefined,
  });

  console.log(`Wrote ${written.length} script file(s) to ${outDir}`);
  if (skipped.length > 0) {
    console.warn(`Skipped ${skipped.length} endpoint(s):`);
    for (const s of skipped) {
      console.warn(`  ${s.method.toUpperCase()} ${s.path}: ${s.reason}`);
    }
  }
}

/**
 * Prompts the user to pick zero or more reusable data generators (VIN,
 * customer, random test name, ...) and, for parameterized ones, their
 * options. Returns a combined Pre-request Script string (or "" if none
 * picked).
 */
async function promptGeneratorScript() {
  const { ids } = await prompts(
    {
      type: "multiselect",
      name: "ids",
      message: "Pick data generator(s) to include (space to select, enter to confirm; leave empty for none)",
      choices: listGenerators().map((g) => ({ title: g.label, value: g.id })),
    },
    { onCancel }
  );

  if (!ids || ids.length === 0) return "";

  const selections = [];
  for (const id of ids) {
    const generator = listGenerators().find((g) => g.id === id);
    if (generator.params.length === 0) {
      selections.push({ id });
      continue;
    }
    const paramQuestions = generator.params.map((p) => ({
      type: "text",
      name: p.name,
      message: `[${id}] ${p.label}`,
      initial: p.default,
    }));
    const params = await prompts(paramQuestions, { onCancel });
    selections.push({ id, params });
  }

  return buildPreRequestScript(selections);
}

async function runGeneratorScript() {
  const script = await promptGeneratorScript();
  if (!script) {
    console.log("No generators selected.");
    return;
  }

  const { destination } = await prompts(
    {
      type: "select",
      name: "destination",
      message: "What should I do with the script?",
      choices: [
        { title: "Print it here", value: "stdout" },
        { title: "Save it to a file", value: "file" },
      ],
    },
    { onCancel }
  );

  if (destination === "file") {
    const { outFile } = await prompts({ type: "text", name: "outFile", message: "File path to save to", initial: "./pre-request.js" }, { onCancel });
    fs.writeFileSync(path.resolve(outFile), script, "utf8");
    console.log(`Saved to ${outFile}`);
  } else {
    console.log("\n" + script + "\n");
  }
}

async function runFullCollection(api) {
  const { outFile, name, filter, status } = await prompts(
    [
      { type: "text", name: "outFile", message: "File path for the generated collection JSON", initial: "./collection.json" },
      { type: "text", name: "name", message: "Collection name (leave blank to use the spec's title)", initial: "" },
      { type: "text", name: "filter", message: "Only include paths matching this regex (leave blank for all)", initial: "" },
      { type: "text", name: "status", message: "Force a status code for every endpoint (leave blank to auto-detect)", initial: "" },
    ],
    { onCancel }
  );

  const { attachGenerators } = await prompts(
    { type: "confirm", name: "attachGenerators", message: "Attach a data-generator Pre-request Script to every request?", initial: false },
    { onCancel }
  );
  const preRequestScript = attachGenerators ? await promptGeneratorScript() : undefined;

  const collection = buildCollection(api, {
    statusCode: status ? Number(status) : undefined,
    pathFilter: filter ? new RegExp(filter) : undefined,
    collectionName: name || undefined,
    preRequestScript: preRequestScript || undefined,
  });

  fs.writeFileSync(path.resolve(outFile), JSON.stringify(collection, null, 2), "utf8");
  console.log(`Collection with ${collection.item.length} request(s) written to ${outFile}`);
}

async function runInteractive() {
  console.log("postman-test-gen - interactive mode\n");
  const api = await promptSpec();

  let again = true;
  while (again) {
    const { action } = await prompts(
      {
        type: "select",
        name: "action",
        message: "What do you want to do?",
        choices: [
          { title: "Generate a test script for one endpoint", value: "single" },
          { title: "Export a script file for every endpoint (organized into folders)", value: "exportAll" },
          { title: "Generate a full Postman collection", value: "collection" },
          { title: "Generate a reusable data-generator Pre-request script (VIN, customer, ...)", value: "generators" },
        ],
      },
      { onCancel }
    );

    if (action === "single") await runSingleScript(api);
    else if (action === "exportAll") await runExportAll(api);
    else if (action === "collection") await runFullCollection(api);
    else if (action === "generators") await runGeneratorScript();

    const { more } = await prompts({ type: "confirm", name: "more", message: "Do something else with this spec?", initial: false }, { onCancel });
    again = more;
  }
}

module.exports = { runInteractive };
