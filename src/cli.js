const fs = require("fs");
const path = require("path");
const { Command } = require("commander");
const { loadSpec } = require("./spec/loadSpec");
const { listOperations, findOperation, pickSuccessStatus, getResponseSchema } = require("./spec/resolveEndpoint");
const { walkSchema } = require("./schema/walkSchema");
const { generateTestScript } = require("./generate/testScript");
const { buildCollection } = require("./generate/collection");
const { exportScripts } = require("./generate/exportScripts");
const { listGenerators, buildPreRequestScript } = require("./generate/dataGenerators");

/** Commander "collect" callback: accumulates repeatable --header "Key: Value" into an object. */
function collectHeader(value, previous) {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex === -1) {
    throw new Error(`Invalid --header "${value}". Expected format: "Key: Value"`);
  }
  const key = value.slice(0, separatorIndex).trim();
  const val = value.slice(separatorIndex + 1).trim();
  return { ...previous, [key]: val };
}

const program = new Command();

program
  .name("postman-test-gen")
  .description("Generates Postman test scripts / collections from OpenAPI (Swagger) schemas, following team test standards.")
  .version("0.1.0");

program
  .command("list")
  .description("List all path + method operations available in a spec")
  .requiredOption("--spec <pathOrUrl>", "Path or URL to the OpenAPI/Swagger document (JSON or YAML)")
  .option("--header <keyValue>", "HTTP header for authenticated spec URLs, e.g. \"Authorization: Bearer xyz\" (repeatable)", collectHeader, {})
  .action(async (opts) => {
    const api = await loadSpec(opts.spec, opts.header);
    const operations = listOperations(api);
    if (operations.length === 0) {
      console.log("No operations found in spec.");
      return;
    }
    for (const op of operations) {
      console.log(`${op.method.toUpperCase().padEnd(6)} ${op.path}${op.summary ? "  # " + op.summary : ""}`);
    }
  });

program
  .command("script")
  .description("Generate a standards-compliant test script for a single endpoint response")
  .requiredOption("--spec <pathOrUrl>", "Path or URL to the OpenAPI/Swagger document")
  .requiredOption("--path <apiPath>", "API path as documented in the spec, e.g. /users/{userId}")
  .requiredOption("--method <verb>", "HTTP method, e.g. get, post")
  .option("--status <code>", "Expected response status code (default: auto-detect - 200, else 201, else 202, else 204, else first documented 2xx)")
  .option("--out <file>", "Write the generated script to a file instead of stdout")
  .option("--header <keyValue>", "HTTP header for authenticated spec URLs, e.g. \"Authorization: Bearer xyz\" (repeatable)", collectHeader, {})
  .action(async (opts) => {
    const api = await loadSpec(opts.spec, opts.header);
    const { operation } = findOperation(api, opts.path, opts.method);
    const statusCode = opts.status ? Number(opts.status) : pickSuccessStatus(operation);
    if (statusCode === undefined) {
      throw new Error(
        `No 2xx response documented for ${opts.method.toUpperCase()} ${opts.path}. Pass --status explicitly if you want to test an error response.`
      );
    }
    const responseSchema = getResponseSchema(operation, statusCode);
    const fields = responseSchema ? walkSchema(responseSchema) : [];

    if (fields.length === 0) {
      console.warn(`Warning: no object schema properties found for ${opts.method.toUpperCase()} ${opts.path} @ ${statusCode}. Generating status-code test only.`);
    }

    const script = generateTestScript({ fields, statusCode });

    if (opts.out) {
      fs.writeFileSync(path.resolve(opts.out), script, "utf8");
      console.log(`Test script written to ${opts.out}`);
    } else {
      console.log(script);
    }
  });

program
  .command("collection")
  .description("Generate a full Postman collection (with embedded test scripts) for all endpoints in a spec")
  .requiredOption("--spec <pathOrUrl>", "Path or URL to the OpenAPI/Swagger document")
  .requiredOption("--out <file>", "Output path for the generated collection JSON")
  .option("--status <code>", "Force this status code for every endpoint (default: auto-detect each endpoint's success status - 200, else 201, else 202, else 204, else first documented 2xx)")
  .option("--filter <regex>", "Only include paths matching this regex")
  .option("--name <name>", "Collection name (defaults to the spec's info.title)")
  .option("--header <keyValue>", "HTTP header for authenticated spec URLs, e.g. \"Authorization: Bearer xyz\" (repeatable)", collectHeader, {})
  .option("--generators <ids>", "Comma-separated data-generator ids to attach as a Pre-request Script on every generated request, e.g. \"vin,customer\" (run the 'generators' command to see available ids)")
  .action(async (opts) => {
    const api = await loadSpec(opts.spec, opts.header);
    const preRequestScript = opts.generators
      ? buildPreRequestScript(opts.generators.split(",").map((id) => ({ id: id.trim() })))
      : undefined;
    const collection = buildCollection(api, {
      statusCode: opts.status ? Number(opts.status) : undefined,
      pathFilter: opts.filter ? new RegExp(opts.filter) : undefined,
      collectionName: opts.name,
      preRequestScript,
    });

    fs.writeFileSync(path.resolve(opts.out), JSON.stringify(collection, null, 2), "utf8");
    console.log(`Collection with ${collection.item.length} request(s) written to ${opts.out}`);
  });

program
  .command("export")
  .description("Generate one test-script .js file per endpoint, organized into folders by API version/resource (mirrors an existing hand-built collection's layout)")
  .requiredOption("--spec <pathOrUrl>", "Path or URL to the OpenAPI/Swagger document")
  .requiredOption("--out <dir>", "Root output directory for the generated script files")
  .option("--status <code>", "Force this status code for every endpoint (default: auto-detect each endpoint's success status)")
  .option("--filter <regex>", "Only include paths matching this regex")
  .option("--header <keyValue>", "HTTP header for authenticated spec URLs, e.g. \"Authorization: Bearer xyz\" (repeatable)", collectHeader, {})
  .action(async (opts) => {
    const api = await loadSpec(opts.spec, opts.header);
    const { written, skipped } = exportScripts(api, {
      outDir: path.resolve(opts.out),
      statusCode: opts.status ? Number(opts.status) : undefined,
      pathFilter: opts.filter ? new RegExp(opts.filter) : undefined,
    });

    console.log(`Wrote ${written.length} script file(s) to ${opts.out}`);
    if (skipped.length > 0) {
      console.warn(`Skipped ${skipped.length} endpoint(s):`);
      for (const s of skipped) {
        console.warn(`  ${s.method.toUpperCase()} ${s.path}: ${s.reason}`);
      }
    }
  });

program
  .command("generators")
  .description("List or combine reusable Pre-request data-generator scripts (VIN, customer, random test name, ...) - not tied to any spec")
  .option("--pick <ids>", 'Comma-separated generator ids to combine into one script, e.g. "vin,customer"')
  .option("--var-name <name>", "Collection variable name (only used by the randomTestName generator)")
  .option("--name-prefix <text>", "Name prefix, e.g. \"Test Tire Category\" (only used by the randomTestName generator)")
  .option("--log-label <text>", "Label used in the console.log message, e.g. \"Category\" (only used by the randomTestName generator)")
  .option("--out <file>", "Write the combined script to a file instead of stdout")
  .action((opts) => {
    if (!opts.pick) {
      console.log("Available generators:\n");
      for (const g of listGenerators()) {
        console.log(`  ${g.id.padEnd(16)} ${g.label}`);
      }
      console.log('\nCombine one or more, e.g.:\n  postman-test-gen generators --pick "vin,customer"');
      console.log('  postman-test-gen generators --pick randomTestName --var-name testTireCategory --name-prefix "Test Tire Category" --log-label Category');
      return;
    }

    const ids = opts.pick.split(",").map((s) => s.trim()).filter(Boolean);
    const selections = ids.map((id) => ({
      id,
      params: { variableName: opts.varName, namePrefix: opts.namePrefix, logLabel: opts.logLabel },
    }));
    const script = buildPreRequestScript(selections);

    if (opts.out) {
      fs.writeFileSync(path.resolve(opts.out), script, "utf8");
      console.log(`Pre-request script written to ${opts.out}`);
    } else {
      console.log(script);
    }
  });

program
  .command("interactive")
  .description("Guided, menu-driven mode: pick a spec and endpoint from a list instead of typing --path/--method by hand")
  .action(async () => {
    const { runInteractive } = require("./interactive");
    await runInteractive();
  });

program
  .command("ui")
  .description("Start a local web UI for browsing a spec and generating scripts/collections without the terminal")
  .option("--port <number>", "Port to listen on", "4747")
  .action((opts) => {
    const { startServer } = require("./ui/server");
    const port = Number(opts.port);
    startServer(port);
    console.log(`postman-test-gen UI running at http://localhost:${port}`);
  });

module.exports = program;
