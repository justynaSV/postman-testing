/**
 * Generates a plausible example value for a (dereferenced) schema, used to
 * pre-fill request bodies in generated collections. Prefers explicit
 * `example`/`default`/`enum` values from the schema before falling back to
 * type/format-based placeholders.
 */

const FORMAT_SAMPLES = {
  uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "date-time": "2024-01-01T12:00:00.000Z",
  date: "2024-01-01",
  email: "user@example.com",
  uri: "https://example.com",
  url: "https://example.com",
};

function sampleForSchema(schema) {
  if (!schema) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case "string":
      return FORMAT_SAMPLES[schema.format] || "string";
    case "integer":
      return 0;
    case "number":
      return 0;
    case "boolean":
      return true;
    case "array": {
      const item = sampleForSchema(schema.items);
      return item === null ? [] : [item];
    }
    case "object": {
      const obj = {};
      const properties = schema.properties || {};
      for (const [key, propSchema] of Object.entries(properties)) {
        obj[key] = sampleForSchema(propSchema);
      }
      return obj;
    }
    default:
      return null;
  }
}

module.exports = { sampleForSchema };
