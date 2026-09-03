# postman-testing

Guideline and standards of creating test scripts in Postman (see [POSTMAN_TEST_STANDARDS.md](POSTMAN_TEST_STANDARDS.md)), plus a CLI tool (`postman-test-gen`) that generates standards-compliant Postman test scripts and collections directly from an OpenAPI/Swagger schema.

## Why

Writing `pm.test` blocks by hand for every field/format/required-check is repetitive and easy to get subtly wrong (missed `haveOwnProperty`, wrong regex, multiple assertions per test, etc.). This tool reads the request/response schemas already documented in your Swagger/OpenAPI spec and generates scripts that follow every rule in the standards doc automatically.

> **New to this tool?** See [INSTRUCTION.md](INSTRUCTION.md) for a step-by-step walkthrough (Web UI, guided interactive mode, or direct commands) — no prior experience with this project needed.

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

To attach a reusable data-generator [Pre-request Script](#generators--reusable-pre-request-data-generator-scripts) (VIN, customer, ...) to every request in the collection, add `--generators`:

```bash
node bin/postman-test-gen.js collection --spec examples/sample-openapi.yaml --out generated-collection.json --generators "vin,customer"
```

### `export` — write one script file per endpoint, organized into folders

Instead of copy-pasting scripts out of the terminal one endpoint at a time:

```bash
node bin/postman-test-gen.js export --spec examples/sample-openapi.yaml --out ./postman-scripts
```

Writes a `.js` file per endpoint, grouped into folders that mirror the layout of a typical hand-built collection — a folder per API version (if the spec uses versioned paths like `/v1/...`), then a folder per resource (title-cased, e.g. `article-update-job` -> `Article Update Job`), e.g.:

```
postman-scripts/
  v1/
    Article Category/
      get-articleCategoryId.js
      post-article-category.js
    Article Category List/
      get-article-category-list.js
  v2/
    Direct Sale/
      post-directSaleId-basket.js
```

Supports `--status`, `--filter`, and `--header` the same as `collection`.

### `generators` — reusable Pre-request data-generator scripts

Separate from schema-derived test scripts, the tool also ships a small library of hand-written [Pre-request Script](https://learning.postman.com/docs/writing-scripts/pre-request-scripts/) snippets for seeding `pm.collectionVariables` with random test data (not tied to any spec). List what's available:

```bash
node bin/postman-test-gen.js generators
```

Combine one or more into a single script (printed to stdout, or written with `--out`):

```bash
node bin/postman-test-gen.js generators --pick "vin,customer"
```

The `randomTestName` generator takes extra options:

```bash
node bin/postman-test-gen.js generators --pick randomTestName \
  --var-name testTireCategory \
  --name-prefix "Test Tire Category" \
  --log-label Category \
  --out pre-request.js
```

Paste the result into a request's (or a folder's/collection's) **Pre-request Script** tab, or attach it automatically to every generated request with `collection --generators` (see above).

### `interactive` — guided menu instead of typing flags

```bash
node bin/postman-test-gen.js interactive
```

(or just `node bin/postman-test-gen.js` with no arguments at all). Prompts you for the spec, then lets you search/pick an endpoint from a list (handy when a spec has hundreds of operations), and walks you through generating a single script, exporting every endpoint's script, building a full collection (optionally attaching data generators), or generating a standalone data-generator Pre-request script — no need to remember exact `--path`/`--method` spelling.

### `ui` — local web page instead of the terminal

```bash
node bin/postman-test-gen.js ui
```

Starts a local server (default `http://localhost:4747`) with a simple page to load a spec (by URL/file path, or by picking a local `.json` file straight from your computer), search/select an endpoint, preview/copy/download its generated script, and build/copy/download reusable data-generator Pre-request scripts — useful for teammates who'd rather not use the CLI at all. Use `--port <number>` to change the port.

When loading by URL/file path, an optional header name/value field pair is available for authenticated specs or APIs that require a specific header to respond (e.g. `Accept-Language`) — same effect as the CLI's `--header` flag, just one header at a time.

> The Web UI's bulk export/collection-generation section is disabled in this version — use the CLI's `export`/`collection` commands (or `interactive` mode) for those instead.

## What gets generated

From each schema property, based on `type`, `format`, `enum`, and `required`:

| Schema info | Generated check |
|---|---|
| `required: true` | Direct `haveOwnProperty` assertion |
| `required: false` | Same assertion, wrapped in an `if (response.hasOwnProperty(...))` guard |
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
src/cli.js                  Commander command definitions (list/script/collection/export/generators/interactive/ui)
src/interactive.js          Guided, prompt-based workflow (used by `interactive` and no-args invocation)
src/spec/                   OpenAPI loading + operation/schema lookup (swagger-parser)
src/schema/                 Schema walking, regex library, example value generation
src/generate/               Test script text generation, full collection assembly, per-endpoint export + folder naming, reusable data-generator scripts (dataGenerators.js)
src/ui/                     Local web UI (Express server + static HTML/JS/CSS)
examples/                   Sample OpenAPI spec for trying the tool out
```

## Roadmap ideas

- Publish as an internal npm package (`npm publish` to a private registry) so the QA team can run `npx postman-test-gen ...` without cloning the repo.
- Add a `--merge` mode for `collection` that updates test scripts in an *existing* hand-built collection instead of generating a brand new one, so manually added requests/tests aren't lost.
- Support `oneOf`/`anyOf`/`allOf` schemas.
- Add a config file (`.postmantestgenrc`) for default status code, base URL variable name, filters, etc.
