const { walkSchema } = require("../schema/walkSchema");
const { sampleForSchema } = require("../schema/exampleValue");
const { generateTestScript } = require("./testScript");
const {
  listOperations,
  findOperation,
  pickSuccessStatus,
  getResponseSchema,
  getRequestBodySchema,
  getParameters,
} = require("../spec/resolveEndpoint");

/** Converts an OpenAPI path template ("/users/{userId}") into a Postman-style
 * raw URL using collection variables ("{{baseUrl}}/users/{{userId}}"), and
 * returns the set of path variable names encountered. */
function toPostmanPath(path) {
  const variables = [];
  const converted = path.replace(/\{([^}]+)\}/g, (_, name) => {
    variables.push(name);
    return `{{${name}}}`;
  });
  return { converted, variables };
}

function buildRequestItem(api, path, method, statusCode) {
  const { operation } = findOperation(api, path, method);
  const responseSchema = getResponseSchema(operation, statusCode);
  const parameters = getParameters(api.paths[path], operation);

  const fields = responseSchema ? walkSchema(responseSchema) : [];
  const testScript = generateTestScript({ fields, statusCode });

  const { converted: rawPath, variables: pathVariables } = toPostmanPath(path);
  const queryParams = parameters.filter((p) => p.in === "query");

  const url = {
    raw: `{{baseUrl}}${rawPath}${queryParams.length ? "?" + queryParams.map((q) => `${q.name}=`).join("&") : ""}`,
    host: ["{{baseUrl}}"],
    path: rawPath.replace(/^\//, "").split("/"),
  };

  if (queryParams.length > 0) {
    url.query = queryParams.map((q) => ({
      key: q.name,
      value: "",
      disabled: !q.required,
    }));
  }

  const request = {
    method: method.toUpperCase(),
    header: [{ key: "Content-Type", value: "application/json" }],
    url,
  };

  const requestBodySchema = getRequestBodySchema(operation);
  if (requestBodySchema) {
    request.body = {
      mode: "raw",
      raw: JSON.stringify(sampleForSchema(requestBodySchema), null, 2),
      options: { raw: { language: "json" } },
    };
  }

  return {
    item: {
      name: operation.summary || `${method.toUpperCase()} ${path}`,
      request,
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: testScript.split("\n"),
          },
        },
      ],
    },
    pathVariables,
  };
}

/**
 * Builds a full Postman v2.1.0 collection from a dereferenced OpenAPI doc.
 *
 * @param {Object} api - dereferenced OpenAPI document
 * @param {Object} [options]
 * @param {number} [options.statusCode=200] - status code to generate response tests for
 * @param {RegExp} [options.pathFilter] - only include paths matching this regex
 * @param {string} [options.collectionName]
/**
 * Builds a full Postman v2.1.0 collection from a dereferenced OpenAPI doc.
 *
 * @param {Object} api - dereferenced OpenAPI document
 * @param {Object} [options]
 * @param {number} [options.statusCode] - force this status code for every endpoint's
 *   test generation; if omitted, each endpoint's success status (200, else 201,
 *   else 202, else 204, else first documented 2xx) is auto-detected instead.
 * @param {RegExp} [options.pathFilter] - only include paths matching this regex
 * @param {string} [options.collectionName]
 */
function buildCollection(api, options = {}) {
  const collectionName = options.collectionName || api.info?.title || "Generated Collection";

  const operations = listOperations(api).filter((op) => (options.pathFilter ? options.pathFilter.test(op.path) : true));

  const items = [];
  const pathVariableNames = new Set();

  for (const op of operations) {
    try {
      const { operation } = findOperation(api, op.path, op.method);
      const statusCode = options.statusCode || pickSuccessStatus(operation);
      if (statusCode === undefined) {
        console.warn(`Skipped ${op.method.toUpperCase()} ${op.path}: no 2xx response documented.`);
        continue;
      }
      const { item, pathVariables } = buildRequestItem(api, op.path, op.method, statusCode);
      items.push(item);
      pathVariables.forEach((v) => pathVariableNames.add(v));
    } catch (err) {
      // Skip operations we can't safely generate a test for (e.g. no JSON
      // response documented for the requested status), but don't abort the
      // whole collection build.
      console.warn(`Skipped ${op.method.toUpperCase()} ${op.path}: ${err.message}`);
    }
  }

  const variables = [{ key: "baseUrl", value: "" }, ...[...pathVariableNames].map((key) => ({ key, value: "" }))];

  return {
    info: {
      name: collectionName,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: items,
    variable: variables,
  };
}

module.exports = { buildCollection };
