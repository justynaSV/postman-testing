const { resolveRegex } = require("../schema/regexLibrary");

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function propAccess(expr, name) {
  return IDENTIFIER_RE.test(name) ? `${expr}.${name}` : `${expr}['${name}']`;
}

/** Label used for a field living directly on `response` or a nested object. */
function ownFieldLabel(contextLabel, fieldName) {
  return contextLabel ? `"${contextLabel}" object contains "${fieldName}"` : `Response contains "${fieldName}"`;
}

/** Label used for a field living on an item of an array (root array or a named array-of-objects field). */
function arrayItemFieldLabel(arrLabel, fieldName) {
  return arrLabel ? `Each "${arrLabel}" item contains "${fieldName}"` : `Each item contains "${fieldName}"`;
}

/** Assertion line checking an array isn't empty, meant to be appended into the array's own existence/type pm.test. */
function notEmptyAssertionLine(arrExpr) {
  return `pm.expect(${arrExpr}.length).to.be.above(0);`;
}

/** A bare "id" field resolving to a UUID is always server-generated, so it never needs an existence guard. */
function isAlwaysGeneratedId(field) {
  if (!field.name || !/^id$/i.test(field.name)) return false;
  const regex = resolveRegex(field.name, field.format);
  return Boolean(regex && regex.varName === "uuidRegex");
}

/** When an id-named field (bare "id" or a camelCase "...Id" suffix, e.g. deliveryNoteId) is the
 * only attribute in the response, it's always present regardless of format. */
function isSoleIdField(field, siblingCount) {
  return siblingCount === 1 && Boolean(field.name) && (/^id$/i.test(field.name) || /Id$/.test(field.name));
}

/**
 * Builds the pm.test() lines for a single field's "own" assertion
 * (existence + format/type/enum), NOT including children/items recursion.
 * Returns { title, chain } where `chain` is the Chai expression appended
 * after `pm.expect(<parentExpr>).to.haveOwnProperty('<name>')`.
 * `label` is the fully-built label text (see ownFieldLabel/arrayItemFieldLabel).
 */
function buildOwnCheck(field, label) {
  if (field.type === "object") {
    return { title: `${label} object`, chain: `.to.be.an('object')` };
  }

  if (field.type === "array") {
    return { title: `${label} array which is not empty`, chain: `.to.be.an('array')` };
  }

  const regex = resolveRegex(field.name, field.format);
  if (regex) {
    return {
      title: `${label} which is a ${regex.description.replace(/ format$/, "")}`,
      chain: `.to.match(${regex.varName})`,
      regex,
    };
  }

  if (field.enum && field.enum.length > 0) {
    return {
      title: `${label} attribute with a valid value`,
      chain: `.to.be.oneOf(${JSON.stringify(field.enum)})`,
    };
  }

  if (field.type) {
    return { title: `${label} which is a ${field.type}`, chain: `.to.be.a('${field.type}')` };
  }

  return { title: `${label} attribute`, chain: "" };
}

/**
 * Builds the pm.test() check for each element of an array of primitives
 * (i.e. items.type !== 'object'), mirroring the team's existing
 * `array.forEach(item => pm.expect(item)...)` style for validating every
 * entry's format/enum/type. Returns undefined if there's nothing meaningful
 * to check (e.g. items schema has no type/format/enum at all).
 * `arrLabel` is the array field's name (undefined/null for a root array).
 */
function buildArrayItemCheck(field, arrLabel) {
  const items = field.items;
  if (!items || items.type === "object") return undefined;

  const itemLabel = arrLabel ? `"${arrLabel}" item` : "item";

  const regex = resolveRegex(field.name, items.format);
  if (regex) {
    return {
      title: `Each ${itemLabel} is in ${regex.description}`,
      chain: `.to.match(${regex.varName})`,
      regex,
    };
  }

  if (items.enum && items.enum.length > 0) {
    return {
      title: `Each ${itemLabel} has a valid value`,
      chain: `.to.be.oneOf(${JSON.stringify(items.enum)})`,
    };
  }

  if (items.type) {
    return {
      title: `Each ${itemLabel} is of type ${items.type}`,
      chain: `.to.be.a('${items.type}')`,
    };
  }

  return undefined;
}

class ScriptBuilder {
  constructor() {
    this.lines = [];
    this.usedRegex = new Map(); // varName -> pattern
    this.declaredVars = new Set();
  }

  push(line, indent = 0) {
    this.lines.push(line === "" ? "" : "    ".repeat(indent) + line);
  }

  registerRegex(regex) {
    if (regex && !this.usedRegex.has(regex.varName)) {
      this.usedRegex.set(regex.varName, regex.pattern);
    }
  }

  /** Reserves `name` as a shorthand variable name; returns null if it's already taken (caller falls back to the full path) or isn't a valid identifier. */
  declareVar(name) {
    if (!IDENTIFIER_RE.test(name) || this.declaredVars.has(name)) return null;
    this.declaredVars.add(name);
    return name;
  }

  /** Drops any trailing blank lines already pushed, so a closing `}` doesn't end up with an empty line right before it. */
  trimTrailingBlankLines() {
    while (this.lines.length > 0 && this.lines[this.lines.length - 1] === "") {
      this.lines.pop();
    }
  }
}

/**
 * Emits one pm.test() block, optionally nesting its body inside a sequence of
 * wrapper statements - `array.forEach(item => { ... })` loops and/or
 * `if (guard) { ... }` existence guards (for optional fields checked
 * per-item). `wraps` is an ordered list of `{ kind: 'forEach', arrExpr,
 * itemVar }` or `{ kind: 'guard', condition }` entries, applied outermost
 * first in the order given - order matters, e.g. a guard for an optional
 * array must precede the forEach that iterates it. `bodyFn(bodyIndent)`
 * pushes the actual assertion line(s) at the resulting innermost indent.
 */
function emitTest(builder, indent, title, wraps, bodyFn) {
  builder.push(`pm.test('${title.replace(/'/g, "\\'")}', () => {`, indent);
  let cur = indent + 1;
  for (const wrap of wraps) {
    if (wrap.kind === "forEach") {
      builder.push(`${wrap.arrExpr}.forEach(${wrap.itemVar} => {`, cur);
    } else {
      builder.push(`if (${wrap.condition}) {`, cur);
    }
    cur++;
  }
  bodyFn(cur);
  for (let i = wraps.length - 1; i >= 0; i--) {
    cur--;
    builder.push(wraps[i].kind === "forEach" ? `});` : `}`, cur);
  }
  builder.push(`});`, indent);
  builder.push("", indent);
}

/** Picks a non-colliding forEach item variable name based on how many forEach wraps are already open. */
function itemVarForDepth(wraps) {
  const depth = wraps.filter((w) => w.kind === "forEach").length;
  return depth === 0 ? "item" : `item${depth + 1}`;
}

/**
 * Renders a single field's checks for an item living inside a forEach loop
 * (i.e. an object field of an array, at any nesting depth). Unlike
 * `renderField` (used for the plain response-object case), the existence
 * guard for optional fields must live *inside* the forEach body (since only
 * some items may have the field), so guards are accumulated in `wraps` and
 * threaded through recursion instead of wrapping the whole pm.test call.
 */
function renderForEachField(builder, field, itemExpr, indent, label, wraps, siblingCount, depth = 0) {
  const own = buildOwnCheck(field, label);
  builder.registerRegex(own.regex);
  const assertionLine = `pm.expect(${itemExpr}).to.haveOwnProperty('${field.name}')${own.chain};`;
  const fieldRef = propAccess(itemExpr, field.name);

  // Generated "id" (uuid) fields and a sole "id" field are treated as always present, same as a
  // top-level (depth 0) object or array - nested objects/arrays deeper than that still respect
  // `required` since they're not guaranteed to always be populated - only an object's own
  // optional children get individual guards below.
  const nextWraps = field.required || ((field.type === "object" || field.type === "array") && depth === 0) || isAlwaysGeneratedId(field) || isSoleIdField(field, siblingCount)
    ? wraps
    : [...wraps, { kind: "guard", condition: `${itemExpr}.hasOwnProperty('${field.name}')` }];

  emitTest(builder, indent, own.title, nextWraps, (bodyIndent) => {
    builder.push(assertionLine, bodyIndent);
    if (field.type === "array") {
      builder.push(notEmptyAssertionLine(fieldRef), bodyIndent);
    }
  });

  if (field.type === "object" && field.children && field.children.length > 0) {
    for (const child of field.children) {
      renderForEachField(builder, child, fieldRef, indent, ownFieldLabel(field.name, child.name), nextWraps, field.children.length, depth + 1);
    }
  }

  if (field.type === "array") {
    renderArrayChecks(builder, fieldRef, field, indent, field.name, nextWraps);
  }
}

/**
 * Renders the "not empty" + per-item checks for an array field, whether it's
 * the root response itself (`arrLabel` undefined) or a named array-of-objects
 * field at any nesting depth. Every item is validated via `.forEach(...)`
 * (not just the first), matching the team's real hand-written style.
 */
function renderArrayChecks(builder, arrExpr, field, indent, arrLabel, wraps) {
  const items = field.items;
  if (!items) return;

  const isObjectItems = items.type === "object" && items.children && items.children.length > 0;

  // Hoist `const <name> = <fullPath>;` once so every per-item test's forEach references the
  // short name instead of repeating the full path. Only safe when the array itself is reachable
  // outside a forEach body (i.e. it lives directly on response or nested only inside plain
  // objects) - a loop item variable like `item` doesn't exist outside its own forEach callback,
  // so arrays nested inside another array's forEach keep using their full item-relative path.
  let effectiveArrExpr = arrExpr;
  const insideForEach = wraps.some((w) => w.kind === "forEach");
  if (isObjectItems && !insideForEach && field.name) {
    const varName = builder.declareVar(field.name);
    if (varName) {
      builder.push(`const ${varName} = ${arrExpr};`, indent);
      builder.push("", indent);
      effectiveArrExpr = varName;
    }
  }

  const itemVar = itemVarForDepth(wraps);
  const itemWraps = [...wraps, { kind: "forEach", arrExpr: effectiveArrExpr, itemVar }];

  if (isObjectItems) {
    for (const child of items.children) {
      renderForEachField(builder, child, itemVar, indent, arrayItemFieldLabel(arrLabel, child.name), itemWraps, items.children.length);
    }
  } else {
    const itemCheck = buildArrayItemCheck(field, arrLabel);
    if (itemCheck) {
      builder.registerRegex(itemCheck.regex);
      emitTest(builder, indent, itemCheck.title, itemWraps, (bodyIndent) => {
        builder.push(`pm.expect(${itemVar})${itemCheck.chain};`, bodyIndent);
      });
    }
  }
}

/** Renders checks for a response whose top-level schema is itself an array. */
function renderRootArray(builder, field, indent) {
  emitTest(builder, indent, "Response is an array", [], (bodyIndent) => {
    builder.push(`pm.expect(response).to.be.an('array');`, bodyIndent);
    builder.push(notEmptyAssertionLine("response"), bodyIndent);
  });
  renderArrayChecks(builder, "response", field, indent, undefined, []);
}

function renderField(builder, field, parentExpr, indent, contextLabel, siblingCount, depth = 0) {
  const own = buildOwnCheck(field, ownFieldLabel(contextLabel, field.name));
  builder.registerRegex(own.regex);

  const fieldRef = propAccess(parentExpr, field.name);

  const emitOwnTest = (useIndent) => {
    builder.push(`pm.test('${own.title.replace(/'/g, "\\'")}', () => {`, useIndent);
    builder.push(`pm.expect(${parentExpr}).to.haveOwnProperty('${field.name}')${own.chain};`, useIndent + 1);
    if (field.type === "array") {
      builder.push(notEmptyAssertionLine(fieldRef), useIndent + 1);
    }
    builder.push(`});`, useIndent);
    builder.push("", useIndent);
  };

  const emitChildren = (innerIndent) => {
    if (field.type === "object" && field.children && field.children.length > 0) {
      // With more than one attribute to check, a shorthand variable shortens every child test.
      let childParentExpr = fieldRef;
      if (field.children.length > 1) {
        const varName = builder.declareVar(field.name);
        if (varName) {
          builder.push(`let ${varName} = ${fieldRef};`, innerIndent);
          childParentExpr = varName;
        }
      }
      for (const child of field.children) {
        renderField(builder, child, childParentExpr, innerIndent, field.name, field.children.length, depth + 1);
      }
    }

    if (field.type === "array") {
      renderArrayChecks(builder, fieldRef, field, innerIndent, field.name, []);
    }
  };

  // Generated "id" (uuid) fields and a sole "id" field are treated as always present, same as a
  // top-level (depth 0) object or array - nested objects/arrays deeper than that still respect
  // `required` since they're not guaranteed to always be populated - only an object's own
  // optional children get individual guards below.
  if (field.required || ((field.type === "object" || field.type === "array") && depth === 0) || isAlwaysGeneratedId(field) || isSoleIdField(field, siblingCount)) {
    emitOwnTest(indent);
    emitChildren(indent);
  } else {
    builder.push(`if (${parentExpr}.hasOwnProperty('${field.name}')) {`, indent);
    emitOwnTest(indent + 1);
    emitChildren(indent + 1);
    builder.trimTrailingBlankLines();
    builder.push(`}`, indent);
    builder.push("", indent);
  }
}

/**
 * For status 400 (validation error) responses, only "errors[].message" and
 * "errors[].code" are worth asserting - any other top-level field and any
 * other attribute on each error item is skipped, per the simplified
 * error-testing rule. Returns `fields` unchanged if there's no top-level
 * "errors" array to restrict.
 */
function restrictToErrorFields(fields) {
  const errorsField = fields.find((f) => f.name === "errors" && f.type === "array");
  if (!errorsField || !errorsField.items || !errorsField.items.children) return fields;

  return [
    {
      ...errorsField,
      items: {
        ...errorsField.items,
        children: errorsField.items.children.filter((c) => c.name === "message" || c.name === "code"),
      },
    },
  ];
}

/**
 * Generates a full, standards-compliant Postman test script (as a string)
 * for a single endpoint response.
 *
 * @param {Object} params
 * @param {Array} params.fields - top-level FieldSpec[] from walkSchema()
 * @param {number} params.statusCode - expected HTTP status code
 * @param {string} [params.title] - optional custom title for the status test
 */
function generateTestScript({ fields, statusCode, title }) {
  const builder = new ScriptBuilder();
  const effectiveFields = statusCode === 400 ? restrictToErrorFields(fields) : fields;

  // Body of the script (everything after the status test + response parse),
  // built first so we know exactly which regex constants are actually used.
  const bodyBuilder = new ScriptBuilder();
  for (const field of effectiveFields) {
    if (field.isRoot) {
      renderRootArray(bodyBuilder, field, 0);
    } else {
      renderField(bodyBuilder, field, "response", 0, undefined, effectiveFields.length);
    }
  }

  const statusTitle = title || `Verify response status code is ${statusCode}`;
  builder.push(`pm.test('${statusTitle.replace(/'/g, "\\'")}', () => {`);
  builder.push(`pm.response.to.have.status(${statusCode});`, 1);
  builder.push(`});`);

  // No fields means no response body to parse/assert on - skip the parse line entirely.
  if (effectiveFields.length > 0) {
    builder.push("");
    builder.push(`const response = pm.response.json();`);
  }

  if (bodyBuilder.usedRegex.size > 0) {
    for (const [varName, pattern] of bodyBuilder.usedRegex) {
      builder.push(`const ${varName} = ${pattern};`);
    }
  }
  builder.push("");

  builder.lines.push(...bodyBuilder.lines);

  // Trim trailing blank lines.
  while (builder.lines.length > 0 && builder.lines[builder.lines.length - 1] === "") {
    builder.lines.pop();
  }

  return builder.lines.join("\n");
}

module.exports = { generateTestScript };
