const fs = require("fs");
const path = require("path");
const { Command } = require("commander");
const { loadSpec } = require("./spec/loadSpec");
const { listOperations, findOperation, pickSuccessStatus, getResponseSchema } = require("./spec/resolveEndpoint");
const { walkSchema } = require("./schema/walkSchema");
const { generateTestScript } = require("./generate/testScript");
const { buildCollection } = require("./generate/collection");

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
  .action(async (opts) => {
    const api = await loadSpec(opts.spec, opts.header);
    const collection = buildCollection(api, {
      statusCode: opts.status ? Number(opts.status) : undefined,
      pathFilter: opts.filter ? new RegExp(opts.filter) : undefined,
      collectionName: opts.name,
    });

    fs.writeFileSync(path.resolve(opts.out), JSON.stringify(collection, null, 2), "utf8");
    console.log(`Collection with ${collection.item.length} request(s) written to ${opts.out}`);
  });

module.exports = program;
