/**
 * Recursively walks a (dereferenced) JSON Schema / OpenAPI schema object and
 * produces a tree of FieldSpec nodes describing every property found, so the
 * generator can turn each one into standards-compliant pm.test blocks.
 *
 * FieldSpec shape:
 * {
 *   name: string,              // property name
 *   path: string[],            // full property path from the response root
 *   required: boolean,         // whether the parent schema marks this required
 *   type: string|undefined,    // 'string' | 'number' | 'boolean' | 'array' | 'object'
 *   format: string|undefined,  // OpenAPI 'format', e.g. 'uuid', 'date-time'
 *   enum: any[]|undefined,
 *   nullable: boolean,
 *   children: FieldSpec[]|undefined,   // populated when type === 'object'
 *   items: {                            // populated when type === 'array'
 *     type: string|undefined,
 *     format: string|undefined,
 *     enum: any[]|undefined,
 *     children: FieldSpec[]|undefined,  // populated when items are objects
 *   }|undefined,
 * }
 */

function normalizeType(schema) {
  if (!schema) return undefined;
  if (schema.type === "integer") return "number";
  return schema.type;
}

function walkObjectProperties(schema, parentPath) {
  if (!schema || !schema.properties) return [];
  const requiredSet = new Set(schema.required || []);

  return Object.entries(schema.properties).map(([name, propSchema]) =>
    buildFieldSpec(name, propSchema, parentPath, requiredSet.has(name))
  );
}

function buildFieldSpec(name, schema, parentPath, required) {
  const path = [...parentPath, name];
  const type = normalizeType(schema);

  const field = {
    name,
    path,
    required: Boolean(required),
    type,
    format: schema && schema.format,
    enum: schema && schema.enum,
    nullable: Boolean(schema && (schema.nullable || (Array.isArray(schema.type) && schema.type.includes("null")))),
  };

  if (type === "object") {
    field.children = walkObjectProperties(schema, path);
  }

  if (type === "array" && schema.items) {
    const itemType = normalizeType(schema.items);
    field.items = {
      type: itemType,
      format: schema.items.format,
      enum: schema.items.enum,
      children: itemType === "object" ? walkObjectProperties(schema.items, [...path, "0"]) : undefined,
    };
  }

  return field;
}

/**
 * Entry point: walk a top-level response/request body schema and return the
 * list of top-level FieldSpecs. Handles two root shapes:
 *  - an object schema: returns its properties as usual.
 *  - an array schema (e.g. a response that's a bare JSON array): returns a
 *    single synthetic FieldSpec with `isRoot: true` and `name: null`
 *    representing the response itself, so the generator can emit
 *    array/item checks directly against `response` instead of a named
 *    property. Any other root shape (primitive) returns no fields.
 */
function walkSchema(rootSchema) {
  if (!rootSchema) return [];

  if (rootSchema.type === "array") {
    const field = buildFieldSpec("response", rootSchema, [], true);
    field.name = null;
    field.isRoot = true;
    return [field];
  }

  if (rootSchema.type !== "object") {
    return [];
  }

  return walkObjectProperties(rootSchema, []);
}

module.exports = { walkSchema };
