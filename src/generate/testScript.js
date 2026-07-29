const { resolveRegex } = require("../schema/regexLibrary");

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function propAccess(expr, name) {
  return IDENTIFIER_RE.test(name) ? `${expr}.${name}` : `${expr}['${name}']`;
}

/**
 * Builds the pm.test() lines for a single field's "own" assertion
 * (existence + format/type/enum), NOT including children/items recursion.
 * Returns { title, chain } where `chain` is the Chai expression appended
 * after `pm.expect(<parentExpr>).to.haveOwnProperty('<name>')`.
 */
function buildOwnCheck(field, contextLabel) {
  const label = contextLabel
    ? `"${contextLabel}" object contains "${field.name}"`
    : `Response contains "${field.name}"`;

  if (field.type === "object") {
    return { title: `${label} attribute as an object`, chain: `.that.is.an('object')` };
  }

  if (field.type === "array") {
    return { title: `${label} attribute as an array`, chain: `.that.is.an('array')` };
  }

  const regex = resolveRegex(field.name, field.format);
  if (regex) {
    return {
      title: `${label} attribute in ${regex.description}`,
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
    return { title: `${label} attribute of type ${field.type}`, chain: `.to.be.a('${field.type}')` };
  }

  return { title: `${label} attribute`, chain: "" };
}

/**
 * Builds the pm.test() check for each element of an array of primitives
 * (i.e. items.type !== 'object'), mirroring the team's existing
 * `array.forEach(item => pm.expect(item)...)` style for validating every
 * entry's format/enum/type. Returns undefined if there's nothing meaningful
 * to check (e.g. items schema has no type/format/enum at all).
 */
function buildArrayItemCheck(field) {
  const items = field.items;
  if (!items || items.type === "object") return undefined;

  const regex = resolveRegex(field.name, items.format);
  if (regex) {
    return {
      title: `Each "${field.name}" item is in ${regex.description}`,
      chain: `.to.match(${regex.varName})`,
      regex,
    };
  }

  if (items.enum && items.enum.length > 0) {
    return {
      title: `Each "${field.name}" item has a valid value`,
      chain: `.to.be.oneOf(${JSON.stringify(items.enum)})`,
    };
  }

  if (items.type) {
    return {
      title: `Each "${field.name}" item is of type ${items.type}`,
      chain: `.to.be.a('${items.type}')`,
    };
  }

  return undefined;
}

class ScriptBuilder {
  constructor() {
    this.lines = [];
    this.usedRegex = new Map(); // varName -> pattern
  }

  push(line, indent = 0) {
    this.lines.push(line === "" ? "" : "    ".repeat(indent) + line);
  }

  registerRegex(regex) {
    if (regex && !this.usedRegex.has(regex.varName)) {
      this.usedRegex.set(regex.varName, regex.pattern);
    }
  }

  /** Drops any trailing blank lines already pushed, so a closing `}` doesn't end up with an empty line right before it. */
  trimTrailingBlankLines() {
    while (this.lines.length > 0 && this.lines[this.lines.length - 1] === "") {
      this.lines.pop();
    }
  }
}

function renderField(builder, field, parentExpr, indent, contextLabel) {
  const own = buildOwnCheck(field, contextLabel);
  builder.registerRegex(own.regex);

  const emitOwnTest = (useIndent) => {
    builder.push(`pm.test('${own.title.replace(/'/g, "\\'")}', () => {`, useIndent);
    builder.push(`pm.expect(${parentExpr}).to.haveOwnProperty('${field.name}')${own.chain};`, useIndent + 1);
    builder.push(`});`, useIndent);
    builder.push("", useIndent);
  };

  const fieldRef = propAccess(parentExpr, field.name);

  const emitChildren = (innerIndent) => {
    if (field.type === "object" && field.children && field.children.length > 0) {
      for (const child of field.children) {
        renderField(builder, child, fieldRef, innerIndent, field.name);
      }
    }

    if (field.type === "array") {
      builder.push(`pm.test('"${field.name}" array is not empty', () => {`, innerIndent);
      builder.push(`pm.expect(${fieldRef}.length).to.be.above(0);`, innerIndent + 1);
      builder.push(`});`, innerIndent);
      builder.push("", innerIndent);

      if (field.items && field.items.type === "object" && field.items.children && field.items.children.length > 0) {
        builder.push(`if (${fieldRef}.length > 0) {`, innerIndent);
        const itemRef = `${fieldRef}[0]`;
        for (const child of field.items.children) {
          renderField(builder, child, itemRef, innerIndent + 1, `${field.name}[0]`);
        }
        builder.trimTrailingBlankLines();
        builder.push(`}`, innerIndent);
        builder.push("", innerIndent);
      } else {
        const itemCheck = buildArrayItemCheck(field);
        if (itemCheck) {
          builder.registerRegex(itemCheck.regex);
          builder.push(`pm.test('${itemCheck.title.replace(/'/g, "\\'")}', () => {`, innerIndent);
          builder.push(`${fieldRef}.forEach((item) => {`, innerIndent + 1);
          builder.push(`pm.expect(item)${itemCheck.chain};`, innerIndent + 2);
          builder.push(`});`, innerIndent + 1);
          builder.push(`});`, innerIndent);
          builder.push("", innerIndent);
        }
      }
    }
  };

  if (field.required) {
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

  // Body of the script (everything after the status test + response parse),
  // built first so we know exactly which regex constants are actually used.
  const bodyBuilder = new ScriptBuilder();
  for (const field of fields) {
    renderField(bodyBuilder, field, "response", 0, undefined);
  }

  const statusTitle = title || `Verify response status code is ${statusCode}`;
  builder.push(`pm.test('${statusTitle.replace(/'/g, "\\'")}', () => {`);
  builder.push(`pm.response.to.have.status(${statusCode});`, 1);
  builder.push(`});`);
  builder.push("");
  builder.push(`const response = pm.response.json();`);
  builder.push("");

  if (bodyBuilder.usedRegex.size > 0) {
    for (const [varName, pattern] of bodyBuilder.usedRegex) {
      builder.push(`const ${varName} = ${pattern};`);
    }
    builder.push("");
  }

  builder.lines.push(...bodyBuilder.lines);

  // Trim trailing blank lines.
  while (builder.lines.length > 0 && builder.lines[builder.lines.length - 1] === "") {
    builder.lines.pop();
  }

  return builder.lines.join("\n") + "\n";
}

module.exports = { generateTestScript };
