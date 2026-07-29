/**
 * Derives a folder/file location for a single endpoint's generated script,
 * mirroring the structure teams typically use in their hand-built Postman
 * collections: a top-level folder per API version (when the spec uses
 * versioned paths like /v1/..., /v2/...), then a folder per resource
 * (title-cased, e.g. "article-update-job" -> "Article Update Job"), then one
 * file per method + remaining path.
 */

function splitPathSegments(apiPath) {
  return apiPath.split("/").filter(Boolean);
}

function isVersionSegment(segment) {
  return /^v\d+$/i.test(segment);
}

function isPathParam(segment) {
  return /^\{.*\}$/.test(segment);
}

/** "article-update-job" -> "Article Update Job" */
function titleCase(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function sanitizeForFileName(str) {
  const cleaned = str
    .replace(/[{}]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "root";
}

/**
 * @param {string} apiPath - e.g. "/v1/article-category/{articleCategoryId}"
 * @param {string} method - e.g. "get"
 * @returns {{ folders: string[], fileName: string }}
 */
function resolveScriptLocation(apiPath, method) {
  const segments = splitPathSegments(apiPath);

  let index = 0;
  let versionFolder;
  if (segments[0] && isVersionSegment(segments[0])) {
    versionFolder = segments[0].toLowerCase();
    index = 1;
  }

  const groupSegment = segments[index] && !isPathParam(segments[index]) ? segments[index] : "root";
  if (segments[index] && !isPathParam(segments[index])) {
    index += 1;
  }

  const remainder = segments.slice(index);
  const remainderSlug = remainder.length > 0 ? sanitizeForFileName(remainder.join("-")) : "";
  const fileBase = remainderSlug ? `${method.toLowerCase()}-${remainderSlug}` : `${method.toLowerCase()}-${groupSegment}`;

  return {
    folders: [versionFolder, titleCase(groupSegment)].filter(Boolean),
    fileName: `${fileBase}.js`,
  };
}

module.exports = { resolveScriptLocation, titleCase };
