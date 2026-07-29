const fs = require("fs");
const SwaggerParser = require("@apidevtools/swagger-parser");

const isUrl = (s) => /^https?:\/\//i.test(s);

/**
 * Cheap sanity check for local files: catches the common mistake of
 * pointing --spec at an exported Postman collection instead of the actual
 * OpenAPI/Swagger document, and fails fast with a clear message.
 */
function assertNotPostmanCollection(specPathOrUrl) {
  if (isUrl(specPathOrUrl)) return;
  let raw;
  try {
    raw = fs.readFileSync(specPathOrUrl, "utf8");
  } catch {
    return; // let SwaggerParser produce the real "file not found" error
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // not JSON (could be YAML OpenAPI) - nothing to check here
  }
  if (parsed && parsed.info && parsed.info._postman_id) {
    throw new Error(
      `"${specPathOrUrl}" is a Postman collection export (has "info._postman_id"), not an OpenAPI/Swagger schema. Point --spec at the actual Swagger/OpenAPI document (JSON/YAML) instead.`
    );
  }
}

/**
 * Loads and fully dereferences an OpenAPI/Swagger document from either a
 * local file path (JSON or YAML) or a remote URL. Dereferencing means all
 * `$ref` pointers are already resolved in the returned object, so the rest
 * of the tool never has to deal with `$ref`.
 *
 * @param {string} specPathOrUrl
 * @param {Object} [headers] - optional HTTP headers (e.g. Authorization/Cookie)
 *   used only when specPathOrUrl is a URL, for specs behind auth.
 */
async function loadSpec(specPathOrUrl, headers) {
  assertNotPostmanCollection(specPathOrUrl);
  try {
    const options = headers && Object.keys(headers).length > 0 ? { resolve: { http: { headers } } } : undefined;
    const api = await SwaggerParser.dereference(specPathOrUrl, options);
    return api;
  } catch (err) {
    throw new Error(`Failed to load/parse OpenAPI spec from "${specPathOrUrl}": ${err.message}`);
  }
}

module.exports = { loadSpec };
