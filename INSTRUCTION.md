# Getting Started with postman-test-gen

A step-by-step guide for generating Postman test scripts from an OpenAPI/Swagger spec — no coding required. Pick whichever option feels most comfortable (Option A is the easiest if you don't like using a terminal).

## 0. One-time setup

1. Make sure [Node.js](https://nodejs.org/) (version 18 or newer) is installed on your machine.
2. Get a copy of this project folder (clone the repo, or copy the folder you were given).
3. Open a terminal in the project folder and install dependencies (only needed once):
   ```bash
   npm install
   ```
4. Have your OpenAPI/Swagger spec ready — either:
   - a URL, e.g. `https://your-domain.com/openapi.json`, or
   - a local file path, e.g. `C:\specs\warehouse-openapi.json`

   > If the spec URL requires login/authentication, ask whoever provided it what header is needed (usually something like `Authorization: Bearer <token>`).

---

## Option A — Web UI (recommended, no terminal typing after setup)

1. In the terminal, run:
   ```bash
   npm run ui
   ```
2. You'll see: `postman-test-gen UI running at http://localhost:4747`
3. Open that address in your browser: **http://localhost:4747**
4. **Load a spec**: paste the path or URL into the "Path or URL" box. If it needs a header, fill in the header name/value fields too. Click **Load spec**.
5. **Pick an endpoint**: use the search box to find it (e.g. type `article-category` or `GET`), then click on it in the list.
6. The test script appears automatically in the box below. You can:
   - Adjust the **Status code** field and click **Regenerate** if you want to test a different response (e.g. 404 instead of 200).
   - Click **Copy to clipboard**, then paste directly into your request's **Tests** tab in Postman.
   - Or click **Download .js file** to save it instead.
7. **Data generators** (bottom of the page): tick the checkboxes for the test-data snippets you want (e.g. VIN, customer, random test name — fill in its extra fields if shown), click **Generate script**, then **Copy to clipboard** or **Download .js file** and paste it into a request's/folder's **Pre-request Script** tab in Postman. These are independent of any spec — no need to load one first.
8. When you're done, go back to the terminal and press `Ctrl+C` to stop the server.

   > Bulk export / full-collection generation is not available in the Web UI in this version — use **Option B** (interactive mode) or **Option C** (direct `export`/`collection` commands) for those instead.

---

## Option B — Interactive terminal mode (menu-driven, no flags to remember)

1. In the terminal, run:
   ```bash
   node bin/postman-test-gen.js
   ```
   (running it with no extra words launches the guided mode automatically)
2. Answer the prompts as they appear:
   - Paste your spec path/URL.
   - Say "yes" if it needs an auth header, then provide it as `Key: Value` (e.g. `Authorization: Bearer abc123`).
   - Choose what you want to do:
     - **Generate a test script for one endpoint** — search/select the endpoint from the list (type to filter), confirm the status code, then choose to print it or save it to a file.
     - **Export a script file for every endpoint** — choose an output folder; every endpoint gets its own file, organized like a real collection.
     - **Generate a full Postman collection** — choose an output file path; you'll then be asked if you want to attach a data-generator Pre-request Script to every request (pick from the list if so); get one importable `.json` file with everything included.
     - **Generate a reusable data-generator Pre-request script** — pick one or more generators (e.g. VIN, customer, random test name), fill in any extra options, then choose to print it or save it to a file. Independent of any spec.
3. When finished, it asks if you want to do something else with the same spec — answer "no" to exit.

---

## Option C — Direct commands (for anyone comfortable with a terminal)

Replace `<spec>` with your file path or URL below.

**See all available endpoints:**
```bash
node bin/postman-test-gen.js list --spec <spec>
```

**Generate a script for one endpoint** (quote `--path` if it contains `{}`):
```bash
node bin/postman-test-gen.js script --spec <spec> --path "/users/{userId}" --method get --out my-test.js
```

**Generate a script file per endpoint, organized into folders:**
```bash
node bin/postman-test-gen.js export --spec <spec> --out ./postman-scripts
```

**Generate a full Postman collection:**
```bash
node bin/postman-test-gen.js collection --spec <spec> --out collection.json
```

**List/generate reusable data-generator Pre-request scripts** (VIN, customer, random test name — not tied to any spec):
```bash
node bin/postman-test-gen.js generators
node bin/postman-test-gen.js generators --pick "vin,customer" --out pre-request.js
```

Attach generators to every request in a generated collection instead of pasting the script by hand:
```bash
node bin/postman-test-gen.js collection --spec <spec> --out collection.json --generators "vin,customer"
```

If your spec URL needs an auth header, add it to any of the commands above:
```bash
--header "Authorization: Bearer <token>"
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `unknown option '-encodedCommand'` in PowerShell | Wrap `--path` values in quotes, e.g. `--path "/users/{userId}"` — PowerShell treats unquoted `{}` specially. |
| `No 2xx response documented for ...` | The endpoint has no documented success response in the spec. Pass `--status <code>` explicitly if you want to generate a test for an error response (e.g. 404). |
| Error mentioning `_postman_id` | You pointed the tool at an exported **Postman collection** file instead of the actual **OpenAPI/Swagger** spec. Ask for the real spec URL/file instead. |
| Spec fails to load with an auth/401-style error | Add `--header "Authorization: Bearer <token>"` (CLI) or fill in the header fields (Web UI / Interactive mode). |

For details on exactly what each generated test checks, see [POSTMAN_TEST_STANDARDS.md](POSTMAN_TEST_STANDARDS.md) and the main [README.md](README.md).
