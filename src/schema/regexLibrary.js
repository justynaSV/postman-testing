/**
 * Central library of reusable regex constants, keyed by OpenAPI `format`
 * (falls back to a few `name`-based heuristics for common fields that
 * don't have a dedicated OpenAPI format, e.g. slugs).
 *
 * Mirrors POSTMAN_TEST_STANDARDS.md Section 13: declare once, reuse everywhere.
 *
 * `pattern` is written out as a literal JS regex source string (not a real
 * RegExp instance) because it gets embedded verbatim into generated scripts.
 */

const REGEX_BY_FORMAT = {
  uuid: {
    varName: "uuidRegex",
    pattern: "/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i",
    description: "UUID format",
  },
  "date-time": {
    varName: "dateRegex",
    pattern: "/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{0,3})?Z$/",
    description: "ISO date format",
  },
  date: {
    varName: "dateOnlyRegex",
    pattern: "/^\\d{4}-\\d{2}-\\d{2}$/",
    description: "date format (YYYY-MM-DD)",
  },
  email: {
    varName: "emailRegex",
    pattern: "/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/",
    description: "email format",
  },
  uri: {
    varName: "urlRegex",
    pattern: "/^https?:\\/\\/\\S+$/",
    description: "URL format",
  },
  url: {
    varName: "urlRegex",
    pattern: "/^https?:\\/\\/\\S+$/",
    description: "URL format",
  },
};

// Heuristics based on property name, used only when the schema has no
// explicit `format` but the name strongly implies one (common in real APIs).
const REGEX_BY_NAME_HEURISTIC = [
  { test: /slug$/i, key: "slug" },
  { test: /^id$/i, key: "uuid" },
  { test: /Id$/, key: "uuid" },
  { test: /(createdBy|updatedBy|modifiedBy|deletedBy)$/i, key: "uuid" },
];

const EXTRA_REGEX = {
  slug: {
    varName: "slugRegex",
    pattern: "/^[a-z0-9]+(?:-[a-z0-9]+)*$/",
    description: "slug format",
  },
  uuid: REGEX_BY_FORMAT.uuid,
};

/**
 * Resolve the regex descriptor ({ varName, pattern }) for a field, or
 * undefined if no known format/heuristic applies.
 */
function resolveRegex(fieldName, format) {
  if (format && REGEX_BY_FORMAT[format]) {
    return REGEX_BY_FORMAT[format];
  }
  const heuristic = REGEX_BY_NAME_HEURISTIC.find((h) => h.test.test(fieldName));
  if (heuristic) {
    return EXTRA_REGEX[heuristic.key];
  }
  return undefined;
}

module.exports = { resolveRegex };
