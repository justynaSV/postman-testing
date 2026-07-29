# postman-testing

Guideline and standards of creating test scripts in Postman (see [POSTMAN_TEST_STANDARDS.md](POSTMAN_TEST_STANDARDS.md)), plus a CLI tool (`postman-test-gen`) that generates standards-compliant Postman test scripts and collections directly from an OpenAPI/Swagger schema.

## Why

Writing `pm.test` blocks by hand for every field/format/required-check is repetitive and easy to get subtly wrong (missed `haveOwnProperty`, wrong regex, multiple assertions per test, etc.). This tool reads the request/response schemas already documented in your Swagger/OpenAPI spec and generates scripts that follow every rule in the standards doc automatically.

## Install

```bash
npm install
```

(Not published yet — run locally via `node bin/postman-test-gen.js ...`, or `npm link` to get a global `postman-test-gen` command on your machine.)

## Commands

### `list` — discover available endpoints in a spec

```bash
node bin/postman-test-gen.js list --spec examples/sample-openapi.yaml
```

Works with a local file or a URL:

```bash
node bin/postman-test-gen.js list --spec "https://your-domain.com/openapi.json"
```

If the spec URL requires auth, add one or more `--header` flags:

```bash
node bin/postman-test-gen.js list --spec "https://your-domain.com/openapi.json" --header "Authorization: Bearer <token>"
```

### `script` — generate a test script for one endpoint response

```bash
node bin/postman-test-gen.js script \
  --spec examples/sample-openapi.yaml \
  --path "/users/{userId}" \
  --method get \
  --out tests/get-user.test.js
```

Paste the output into the request's **Tests** tab in Postman. Omit `--out` to print to stdout.

`--status` is optional — if omitted, the endpoint's success status is auto-detected (200, else 201, else 202, else 204, else the first documented 2xx). Pass `--status <code>` to force a specific one (e.g. to generate a test for an error response like 404).

> **PowerShell tip:** always quote `--path` values containing `{}` (e.g. `"/users/{userId}"`), otherwise PowerShell mangles the argument.

### `collection` — generate a full importable Postman collection

```bash
node bin/postman-test-gen.js collection \
  --spec examples/sample-openapi.yaml \
  --out generated-collection.json \
  --filter "^/users"
```

Produces a Postman v2.1 collection with one request per (path, method), each with:
- `{{baseUrl}}` + `{{pathParam}}` collection variables instead of hardcoded URLs
- An example JSON request body generated from the request schema (for POST/PUT/PATCH)
- An embedded, standards-compliant test script generated from the response schema

Each endpoint's success status is auto-detected the same way as `script` (pass `--status <code>` to force one code for every endpoint instead). Endpoints with no documented 2xx response are skipped with a warning, not silently dropped.

`--spec` accepts a local file path (JSON or YAML) or a URL, and also supports `--header` for authenticated specs, same as `list`/`script`.

For a large API, generate scoped collections per resource/version instead of one giant file:

```bash
node bin/postman-test-gen.js collection --spec "https://your-domain.com/openapi.json" --out warehouse-v1.json --filter "^/v1/warehouse"
```

## What gets generated

From each schema property, based on `type`, `format`, `enum`, and `required`:

| Schema info | Generated check |
|---|---|
| `required: true` | Direct `haveOwnProperty` assertion |
| `required: false` | Same assertion, wrapped in an `if (Object.prototype.hasOwnProperty.call(...))` guard |
| `format: uuid / date-time / date / email / uri` | `haveOwnProperty(...).to.match(<regex>)`, regex declared once and reused |
| `enum: [...]` | `haveOwnProperty(...).to.be.oneOf([...])` |
| `type: object` | Existence + `an('object')` check, then recurses into nested properties |
| `type: array` (items are objects) | Existence + `an('array')` check, a non-empty length check, then recurses into `items[0]` guarded by `if (arr.length > 0)` |
| `type: array` (items are primitives) | Existence + `an('array')` check, a non-empty length check, then a `forEach` check validating every item's format/enum/type in one `pm.test` |
| plain `type` (no format/enum) | `haveOwnProperty(...).to.be.a('<type>')` |

Status-code test is always emitted first, `pm.response.json()` is only parsed after it, per [POSTMAN_TEST_STANDARDS.md](POSTMAN_TEST_STANDARDS.md) Section 4.

## Project layout

```
bin/postman-test-gen.js     CLI entry point
src/cli.js                  Commander command definitions
src/spec/                   OpenAPI loading + operation/schema lookup (swagger-parser)
src/schema/                 Schema walking, regex library, example value generation
src/generate/               Test script text generation + full collection assembly
examples/                   Sample OpenAPI spec for trying the tool out
```

## Roadmap ideas

- Publish as an internal npm package (`npm publish` to a private registry) so the QA team can run `npx postman-test-gen ...` without cloning the repo.
- Add a `--merge` mode for `collection` that updates test scripts in an *existing* hand-built collection instead of generating a brand new one, so manually added requests/tests aren't lost.
- Support `oneOf`/`anyOf`/`allOf` schemas.
- Add a config file (`.postmantestgenrc`) for default status code, base URL variable name, filters, etc.
