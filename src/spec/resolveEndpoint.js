const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/**
 * Lists every (path, method) operation defined in a dereferenced OpenAPI doc.
 * Returns [{ path, method, operationId, summary }]
 */
function listOperations(api) {
  const operations = [];
  const paths = api.paths || {};
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      operations.push({
        path,
        method,
        operationId: operation.operationId,
        summary: operation.summary,
      });
    }
  }
  return operations;
}

/**
 * Picks the most sensible "success" status code documented for an
 * operation, so callers don't have to hardcode --status 200 for every
 * endpoint. Preference order: 200, then 201, then 202, then 204, then
 * whichever other 2xx code is numerically smallest. Returns undefined if
 * no 2xx response is documented at all.
 */
function pickSuccessStatus(operation) {
  const responses = operation.responses || {};
  const successCodes = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .map(Number)
    .sort((a, b) => a - b);

  if (successCodes.length === 0) return undefined;

  for (const preferred of [200, 201, 202, 204]) {
    if (successCodes.includes(preferred)) return preferred;
  }
  return successCodes[0];
}

/**
 * Finds a single operation by path + method (case-insensitive method).
 */
function findOperation(api, path, method) {
  const pathItem = (api.paths || {})[path];
  if (!pathItem) {
    throw new Error(`Path "${path}" not found in spec. Use the "list" command to see available paths.`);
  }
  const operation = pathItem[method.toLowerCase()];
  if (!operation) {
    throw new Error(`Method "${method.toUpperCase()}" not found for path "${path}".`);
  }
  return { pathItem, operation };
}

/**
 * Extracts the JSON schema for a given response status code of an operation.
 * Falls back to 'default' if the exact status isn't documented.
 */
function getResponseSchema(operation, statusCode) {
  const responses = operation.responses || {};
  const response = responses[String(statusCode)] || responses.default;
  if (!response) {
    throw new Error(
      `No response documented for status ${statusCode} (and no "default"). Available statuses: ${Object.keys(responses).join(", ") || "none"}`
    );
  }
  const content = response.content || {};
  const jsonContent = content["application/json"] || Object.values(content)[0];
  return jsonContent ? jsonContent.schema : undefined;
}

/**
 * Extracts the JSON schema for an operation's request body, if any.
 */
function getRequestBodySchema(operation) {
  const requestBody = operation.requestBody;
  if (!requestBody) return undefined;
  const content = requestBody.content || {};
  const jsonContent = content["application/json"] || Object.values(content)[0];
  return jsonContent ? jsonContent.schema : undefined;
}

/**
 * Extracts path/query parameter definitions declared on the operation
 * (and inherited from the path item).
 */
function getParameters(pathItem, operation) {
  return [...(pathItem.parameters || []), ...(operation.parameters || [])];
}

module.exports = {
  listOperations,
  findOperation,
  pickSuccessStatus,
  getResponseSchema,
  getRequestBodySchema,
  getParameters,
};
