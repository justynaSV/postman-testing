const test = require("node:test");
const assert = require("node:assert/strict");
const { getResponseSchema, getRequestBodySchema } = require("../src/spec/resolveEndpoint");

test("getResponseSchema - OpenAPI 3.x reads schema from content['application/json']", () => {
  const operation = {
    responses: {
      200: {
        content: {
          "application/json": {
            schema: { type: "object", properties: { id: { type: "string" } } },
          },
        },
      },
    },
  };
  const schema = getResponseSchema(operation, 200);
  assert.deepEqual(schema, { type: "object", properties: { id: { type: "string" } } });
});

test("getResponseSchema - OpenAPI 3.x falls back to first content type when no application/json", () => {
  const operation = {
    responses: {
      200: {
        content: {
          "text/plain": { schema: { type: "string" } },
        },
      },
    },
  };
  assert.deepEqual(getResponseSchema(operation, 200), { type: "string" });
});

test("getResponseSchema - OpenAPI 3.x falls back to 'default' response", () => {
  const operation = {
    responses: {
      default: {
        content: {
          "application/json": { schema: { type: "object" } },
        },
      },
    },
  };
  assert.deepEqual(getResponseSchema(operation, 404), { type: "object" });
});

test("getResponseSchema - OpenAPI 3.x throws when status and default are both missing", () => {
  const operation = { responses: {} };
  assert.throws(() => getResponseSchema(operation, 200), /No response documented for status 200/);
});

test("getResponseSchema - Swagger 2.0 reads schema directly from the response object", () => {
  const operation = {
    responses: {
      200: {
        description: "OK",
        schema: { type: "object", properties: { id: { type: "string" } } },
      },
    },
  };
  const schema = getResponseSchema(operation, 200);
  assert.deepEqual(schema, { type: "object", properties: { id: { type: "string" } } });
});

test("getResponseSchema - Swagger 2.0 response.schema takes precedence over content", () => {
  const operation = {
    responses: {
      200: {
        schema: { type: "string" },
        content: { "application/json": { schema: { type: "object" } } },
      },
    },
  };
  assert.deepEqual(getResponseSchema(operation, 200), { type: "string" });
});

test("getRequestBodySchema - OpenAPI 3.x reads schema from requestBody.content", () => {
  const operation = {
    requestBody: {
      content: {
        "application/json": {
          schema: { type: "object", properties: { name: { type: "string" } } },
        },
      },
    },
  };
  const schema = getRequestBodySchema(operation);
  assert.deepEqual(schema, { type: "object", properties: { name: { type: "string" } } });
});

test("getRequestBodySchema - OpenAPI 3.x returns undefined when there is no requestBody", () => {
  assert.equal(getRequestBodySchema({}), undefined);
});

test("getRequestBodySchema - Swagger 2.0 reads schema from a parameter with in: 'body'", () => {
  const operation = {
    parameters: [
      { name: "userId", in: "path", type: "string" },
      {
        name: "body",
        in: "body",
        schema: { type: "object", properties: { name: { type: "string" } } },
      },
    ],
  };
  const schema = getRequestBodySchema(operation);
  assert.deepEqual(schema, { type: "object", properties: { name: { type: "string" } } });
});

test("getRequestBodySchema - Swagger 2.0 returns undefined when there is no body parameter", () => {
  const operation = {
    parameters: [{ name: "userId", in: "path", type: "string" }],
  };
  assert.equal(getRequestBodySchema(operation), undefined);
});
