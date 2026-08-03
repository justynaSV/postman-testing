# Postman Tests Standards

This guide defines the required conventions for writing test scripts in Postman collections. Following these standards ensures consistency, avoids common false-positive/false-negative bugs, and keeps our test suite reliable and maintainable.

---

## 1. Use arrow functions instead of `function()`

**❌ Avoid:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});
```

**✅ Use:**
```javascript
pm.test("Status code is 200", () => {
    pm.response.to.have.status(200);
});
```

**Why:** Arrow functions are the modern ES6+ convention, more concise, and avoid `this`-binding issues. Postman's `pm.test` callback does not rely on `this`, so arrow functions are safe and preferred for readability and consistency with modern JS/TS codebases.

---

## 2. Use `haveOwnProperty` instead of `have.property`

**❌ Avoid:**
```javascript
pm.expect(response).to.have.property("id");
```

**✅ Use:**
```javascript
pm.expect(response).to.haveOwnProperty("id");
```

**Why:** `have.property` traverses the entire prototype chain, so it can return `true` even when the property is inherited rather than actually present on the object itself. `haveOwnProperty` checks only the object's own properties, giving a precise and trustworthy assertion — critical when validating that a field genuinely exists in an API response body.

---

## 3. Always use `to.eql` instead of `to.equal`

**❌ Avoid:**
```javascript
pm.expect(response.data).to.equal({ id: 1, name: "Test" });
pm.expect(response.status).to.equal("active");
```

**✅ Use:**
```javascript
pm.expect(response.data).to.eql({ id: 1, name: "Test" });
pm.expect(response.status).to.eql("active");
```

**Why:** `to.equal` performs strict reference (`===`) comparison — it only passes for primitives or the exact same object reference, and will **always fail** for two structurally identical but distinct objects/arrays. `to.eql` performs a deep equality check: for objects/arrays it compares structure and values instead of reference; for primitives (strings, numbers, booleans, null/undefined) it behaves identically to `to.equal`, since deep equality falls back to the same comparison as strict equality in that case.

**Rule:** Use `to.eql` for **all** equality assertions — primitives, objects, and arrays alike. Never use `to.equal`. This removes the need to decide "which one do I use here?" on a case-by-case basis and eliminates an entire class of bugs where `to.equal` is mistakenly applied to an object or array.

---

## 4. Never declare `pm.response.json()` before the status code test

**❌ Avoid:**
```javascript
const response = pm.response.json();

pm.test("Verify response status code is 200", () => {
    pm.response.to.have.status(200);
});
```

**✅ Use:**
```javascript
pm.test("Verify response status code is 200", () => {
    pm.response.to.have.status(200);
});

const response = pm.response.json();
```

**Why this causes a false positive:**

- `pm.response.json()` attempts to **parse the response body as JSON immediately**, at the moment the line executes — regardless of whether the status code check has run or passed yet.
- If the actual response is an error (e.g., `500`, `404`, or a non-JSON body such as an HTML error page or empty body), calling `.json()` on it can:
  - **Throw a parsing exception**, which aborts the *entire* script execution before the status code test even runs — meaning the status code test never reports as failed, it just never executes, silently hiding the real failure.
  - Or, if the error response body happens to still be valid JSON (e.g., `{ "error": "Internal Server Error" }`), `response` will simply hold that error payload with no exception thrown, so the script keeps running normally.
- The result: your "status code is 200" test can be misleadingly skipped/not reported due to a crash earlier in the script, giving the illusion that everything before it passed — a **false positive** effect where failures are masked instead of surfaced.
- By declaring `pm.test("status code is 200", ...)` **first**, you guarantee:
  1. The status check is always executed and reported, independent of what happens next.
  2. If the status test fails, you get a clear, accurate signal immediately.
  3. Any subsequent parsing of `pm.response.json()` happens only after you've confirmed (via the test result) that a 200 response — and therefore a valid JSON body — is expected.

**Rule of thumb:** Always validate the response status **before** attempting to parse or use the response body. Structure your script so status validation is the very first test, and body parsing/assertions come after.

---

## 5. Use `const`/`let` instead of `var`

**❌ Avoid:**
```javascript
var response = pm.response.json();
```

**✅ Use:**
```javascript
const response = pm.response.json();
```

**Why:** `var` is function-scoped and hoisted, which can lead to unexpected behavior (e.g., accidental redeclaration, leaking variables outside blocks). `const`/`let` are block-scoped and prevent accidental reassignment bugs. Use `const` by default; use `let` only if the variable needs reassignment.

---

## 6. One assertion per `pm.test()` block

**❌ Avoid:**
```javascript
pm.test("Response is valid", () => {
    pm.response.to.have.status(200);
    const response = pm.response.json();
    pm.expect(response).to.haveOwnProperty("id");
    pm.expect(response.name).to.eql("Test");
});
```

**✅ Use:**
```javascript
pm.test("Status code is 200", () => {
    pm.response.to.have.status(200);
});

const response = pm.response.json();

pm.test("Response has id property", () => {
    pm.expect(response).to.haveOwnProperty("id");
});

pm.test("Response name matches expected value", () => {
    pm.expect(response.name).to.eql("Test");
});
```

**Why:** If multiple assertions are bundled into one `pm.test`, the whole test stops and reports as a single failure at the first failing assertion — you lose visibility into which specific check failed and whether the others would have passed. Splitting into separate `pm.test` blocks gives granular, accurate pass/fail reporting per behavior being verified. Note that `const response = pm.response.json();` is declared **outside and after** the status code test (per Section 4's rule), so it's parsed only once and made available to all subsequent test blocks.

---

## 7. Avoid hardcoded values — use collection variables

**❌ Avoid:**
```javascript
pm.test("Correct user id", () => {
    pm.expect(response.userId).to.eql(12345);
});
```

**✅ Use:**
```javascript
pm.test("Correct user id", () => {
    pm.expect(response.userId).to.eql(Number(pm.collectionVariables.get("expectedUserId")));
});
```

**✅ Alternative — declare the variable separately, then reference it in the test:**
```javascript
const expectedUserId = pm.collectionVariables.get("expectedUserId");

pm.test("Response contains correct user id", () => {
    pm.expect(response.userId).to.eql(expectedUserId);
});
```

**Why:** Hardcoded values break as soon as test data changes (different environment, refreshed test data, different user). Pulling expected values from collection variables makes tests portable and easier to maintain in one place. Declaring `expectedUserId` as its own named constant (rather than calling `pm.collectionVariables.get(...)` inline inside the assertion) also improves readability — it makes clear at a glance what value is being compared against, and lets you reuse the same variable across multiple `pm.test()` blocks without repeating the lookup call each time.

---

## 8. Avoid loose equality (`==`) — always use strict (`===`) in custom logic

**❌ Avoid:**
```javascript
if (response.status == "active") { ... }
```

**✅ Use:**
```javascript
if (response.status === "active") { ... }
```

**Why:** `==` performs type coercion, which can cause subtle bugs (e.g., `"0" == false` is `true`). `===` compares both value and type, avoiding unpredictable coercion behavior. This matters in any custom pre-processing logic used before assertions. (Note: this rule applies to plain JavaScript conditionals, not Chai assertions — for assertions, always use `to.eql` per Section 3.)

---

## 9. Use `to.include`/`to.not.include` for array/substring checks instead of manual loops

**❌ Avoid:**
```javascript
let found = false;
for (let i = 0; i < response.roles.length; i++) {
    if (response.roles[i] === "admin") found = true;
}
pm.expect(found).to.eql(true);
```

**✅ Use:**
```javascript
pm.expect(response.roles).to.include("admin");
```

**Why:** Chai's built-in `to.include` is more concise, less error-prone, and self-documenting compared to manual loops. It also produces clearer failure messages (showing the actual array contents) instead of a generic `true`/`false` mismatch.

---

## 10. Don't assume an attribute exists — check for its presence before validating its format

**❌ Avoid:**
```javascript
pm.test(`Response contains id which is a UUID`, () => {
    pm.expect(response.id).to.match(uuidRegex);
});
```

**✅ Use:**
```javascript
pm.test(`Response contains id which is a UUID`, () => {
    pm.expect(response).to.haveOwnProperty('id').to.match(uuidRegex);
});
```

**Why:** Accessing `response.id` directly assumes the property already exists on the object. If `id` is missing (e.g., `undefined`), `.to.match(...)` will throw a confusing low-level error (`Cannot read properties of undefined` or a Chai type error) instead of a clear, readable assertion failure — making it harder to immediately understand what actually went wrong. By chaining `pm.expect(response).to.haveOwnProperty('id').to.match(uuidRegex)`, you get:
- An explicit existence check first (own property, not inherited — see Section 2), so if `id` is missing, the test fails with a clear "expected response to have property 'id'" message.
- A format check second, chained onto the property's actual value, only evaluated once its presence is confirmed.
- One combined, self-documenting assertion instead of two separate steps, while still surfacing the correct failure reason.

**Rule:** When validating that a field matches a specific format (regex, type, etc.), always assert its presence with `haveOwnProperty` first, then chain the format check — rather than accessing the field directly and assuming it exists.

---

## 11. Avoid redundant `.to.exist` checks and custom messages — use `haveOwnProperty` chaining instead

**❌ Avoid:**
```javascript
pm.test(`"General" object contains "createdAt" which is a ISO date`, () => {
    pm.expect(response.general.createdAt, `createdAt element should exist`).to.exist;
    pm.expect(response.general.createdAt, `createdAt should be a valid ISO 8601 datetime string`)
        .to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{0,3}Z$/i);
});

pm.test(`"General" object contains "directSaleVariantId" which is a UUID`, () => {
    pm.expect(response.general.directSaleVariantId, `directSaleVariantId element should exist`).to.exist;
    pm.expect(response.general.directSaleVariantId, `directSaleVariantId should be a valid UUID-v4 string`)
        .to.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});
```

**✅ Use:**
```javascript
pm.test('"General" object contains "createdAt" which is a ISO date', () => {
    pm.expect(response.general).to.haveOwnProperty('createdAt').to.match(dateRegex);
});

pm.test('"General" object contains "directSaleVariantId" which is a UUID', () => {
    pm.expect(response.general).to.haveOwnProperty('directSaleVariantId').to.match(uuidRegex);
});
```

**Why:**
- **Redundant existence check:** `.to.exist` is a separate assertion checking that the value isn't `null`/`undefined`. Chaining `haveOwnProperty('createdAt')` already asserts that the property is present on the object, making the extra `.to.exist` call redundant when the two are combined into a single chained assertion.
- **Two statements instead of one:** The "Avoid" pattern requires writing out the full property path (`response.general.createdAt`) twice — once for the existence check, once for the format check — doubling the chance of typos and making the test harder to scan at a glance.
- **Custom messages as a workaround:** Passing a descriptive string (e.g., `` `createdAt element should exist` ``) as Chai's second argument is a way to compensate for an assertion that isn't self-explanatory. Once you switch to `haveOwnProperty('createdAt').to.match(dateRegex)`, the property name and expectation are already embedded in the assertion itself and the `pm.test()` title, so custom messages become unnecessary.
- **Direct property access risk:** Accessing `response.general.createdAt` directly (rather than asserting on the parent object with `haveOwnProperty`) means that if `general` itself is missing or malformed, you get a less informative low-level error rather than a clear "expected property to exist" failure.

**Rule:** Never combine `.to.exist` with a separate `.to.match(...)`/format assertion on the same field. Instead, always chain `haveOwnProperty(...).to.match(regex)` (or the appropriate matcher) in one assertion, as established in Section 10. Avoid custom Chai assertion messages as a substitute for clear, chained assertions — the structure itself should make failures self-explanatory.

---

## 12. Prefer `pm.expect(...).to.be.true` / `.false` over `to.eql(true)` for booleans

**❌ Avoid:**
```javascript
pm.expect(response.isActive).to.eql(true);
```

**✅ Use:**
```javascript
pm.expect(response.isActive).to.be.true;
```

**Why:** `to.be.true` is more idiomatic Chai syntax for boolean checks and communicates intent more clearly than comparing against a literal `true`/`false` value with `eql`.

---

## 13. Use predefined regex variables for validating data formats (UUID, date, etc.)

**❌ Avoid:**
```javascript
pm.test(`"General" object contains "createdAt" which is a ISO date`, () => {
    pm.expect(response.general.createdAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{0,3}Z$/i);
});

pm.test(`"General" object contains "directSaleVariantId" which is a UUID`, () => {
    pm.expect(response.general.directSaleVariantId).to.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});
```

**✅ Use:**
```javascript
pm.test("Verify response status code is 200", () => {
    pm.response.to.have.status(200);
});

const response = pm.response.json();

const uuidRegex = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

pm.test('"General" object contains "directSaleVariantId" which is a UUID', () => {
    pm.expect(response.general).to.haveOwnProperty('directSaleVariantId').to.match(uuidRegex);
});

pm.test('"General" object contains "createdAt" which is a ISO date', () => {
    pm.expect(response.general).to.haveOwnProperty('createdAt').to.match(dateRegex);
});
```

**Why:**
- **Duplicated regex literals:** The UUID and date patterns are written inline, directly inside each `pm.test()`. If the same format needs to be validated elsewhere in the same script (or across other request scripts in the collection), the pattern gets copy-pasted again and again, risking subtly different/inconsistent regexes over time.
- **Direct property access instead of `haveOwnProperty`:** Accessing `response.general.createdAt` directly assumes the property already exists (see Section 10) rather than asserting its presence explicitly before checking its format.
- **Reusability:** Declaring `uuidRegex`/`dateRegex` once and reusing them across multiple `pm.test()` blocks avoids copy-pasting the same pattern repeatedly and reduces the risk of inconsistent or subtly different regexes being used in different tests.
- **Readability:** Naming the pattern (`uuidRegex`, `dateRegex`) makes the test's intent immediately clear — you're validating a *format*, not an exact value — without needing to mentally parse a raw regex inline every time.
- **Maintainability:** If the expected format changes (e.g., supporting UUID v4 specifically, or a different date precision), you only update the regex in one place at the top of the script instead of hunting through every test.
- **Correct chaining with `haveOwnProperty`:** `pm.expect(response.general).to.haveOwnProperty('directSaleVariantId').to.match(uuidRegex)` first asserts the property exists on the object (own property, not inherited — see Section 2), then chains `.to.match()` on the *value* of that property to confirm it conforms to the expected format. This combines an existence check and a format check into a single, clear assertion (consistent with Sections 10 and 11).
- **Better failure messages:** If the test fails, Chai reports exactly which value didn't match the pattern, making debugging much faster than a generic manual regex check.

**Placement rule:** Following the standard order established in Section 4, regex constants (like other derived variables) should be declared **after** the status code test and **after** `const response = pm.response.json();`, since they depend on nothing from the response but are only relevant once you've confirmed you have a valid, parseable body to validate.

**Other common patterns worth reusing the same way:**
```javascript
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isoCurrencyRegex = /^[A-Z]{3}$/; // e.g., "USD", "EUR"
const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
```

---

## 14. Use `pm.collectionVariables` instead of `pm.environment`

**Setting a variable:**

**❌ Avoid:**
```javascript
pm.environment.set("lastUserId", response.id);
```

**✅ Use:**
```javascript
pm.collectionVariables.set("lastUserId", response.id);
```

**Why:** Collection variables are scoped to the collection itself and travel with it regardless of which environment is active, making test scripts more portable and less fragile. Relying on `pm.environment` ties your test logic to whichever environment happens to be selected — if a teammate runs the collection with the wrong environment active, or an environment variable is missing/misspelled, tests can fail unpredictably or silently produce incorrect values (e.g., `undefined`). Standardizing on `pm.collectionVariables` keeps shared test data centralized, consistent, and predictable across the whole team regardless of environment switching.

**Rule:** Always use `pm.collectionVariables.set(...)` when storing data for later use (e.g., passing an ID from one request to the next). **Do not use** `pm.environment.set(...)` in test scripts.

---

## Quick reference table

| Category | ❌ Old / Avoid | ✅ New / Required | Reason |
|---|---|---|---|
| Function syntax | `function () {}` | `() => {}` | Modern ES6+ convention, cleaner syntax |
| Property check | `to.have.property` | `to.haveOwnProperty` | Avoids false positives from inherited properties |
| Equality (all types) | `to.equal` | `to.eql` | Deep equality works for both primitives and objects/arrays; removes ambiguity |
| Response parsing order | `pm.response.json()` before status test | Status test first, then parse JSON | Prevents masking failures / false positives |
| Variable declaration | `var` | `const` / `let` | Block scope, avoids hoisting bugs |
| Assertions per test | Multiple assertions per `pm.test` | One assertion per `pm.test` | Granular, accurate pass/fail reporting |
| Expected values | Hardcoded | Collection variables | Portability, single source of truth |
| Comparison operators (JS logic) | `==` | `===` | Avoids type coercion bugs |
| Array/substring checks | Manual loops | `to.include` | Concise, self-documenting, clearer failures |
| Attribute existence + format checks | Direct access, assume it exists | `haveOwnProperty` then chain format check | Surfaces missing-attribute failures clearly |
| Existence + format combined checks | `.to.exist` + separate `.to.match` + custom messages | Chained `haveOwnProperty(...).to.match(regex)` | Removes redundancy, self-documenting |
| Boolean checks | `to.eql(true)` | `to.be.true` | Idiomatic Chai syntax |
| Format validation | Ad hoc/inline regex or missing | Reusable regex constants (UUID, date, etc.) | Reusability, readability, maintainability |
| Variable storage scope | `pm.environment.set` | `pm.collectionVariables.set` | Environment-independent, portable, predictable |

---

## Full example: correct script structure

```javascript
pm.test("Verify response status code is 200", () => {
    pm.response.to.have.status(200);
});

const response = pm.response.json();

const uuidRegex = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const expectedUserId = pm.collectionVariables.get("expectedUserId");

pm.test("Response contains id which is a UUID", () => {
    pm.expect(response).to.haveOwnProperty('id').to.match(uuidRegex);
});

pm.test("Response body matches expected object", () => {
    pm.expect(response.data).to.eql({ id: 1, name: "Test" });
});

pm.test('"General" object contains "directSaleVariantId" which is a UUID', () => {
    pm.expect(response.general).to.haveOwnProperty('directSaleVariantId').to.match(uuidRegex);
});

pm.test('"General" object contains "createdAt" which is a ISO date', () => {
    pm.expect(response.general).to.haveOwnProperty('createdAt').to.match(dateRegex);
});

pm.test("Response contains correct user id", () => {
    pm.expect(response.userId).to.eql(expectedUserId);
});

pm.collectionVariables.set("lastResponseId", response.id);
```

---

## Enforcement tips

- Share this document in the team's collection README or wiki.
- Provide a pre-built Postman snippet/template with the correct structure so team members copy from it instead of writing from scratch.
- During code review, flag any test scripts that violate these rules.
- If exporting scripts to a linted codebase, consider ESLint rules like `prefer-arrow-callback` and `eqeqeq` to catch `function()` and `==` usage automatically.
- Explicitly ban `pm.environment.set` in review checklists in favor of `pm.collectionVariables.set`.
- Explicitly ban `to.equal` in review checklists in favor of `to.eql`.
- Explicitly ban `.to.exist` combined with separate format assertions and custom Chai messages in favor of chained `haveOwnProperty(...).to.match(regex)`.
