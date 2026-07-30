let operations = [];
let selectedOp = null;

const $ = (id) => document.getElementById(id);

function setStatus(el, message, kind) {
  el.textContent = message;
  el.className = "status" + (kind ? " " + kind : "");
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const JS_HIGHLIGHT_PATTERN =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(\b\d+\.?\d*\b)|\b(const|let|var|function|return|if|else|for|while|new|typeof|of|in|true|false|null|undefined|async|await|try|catch|finally|throw|class|extends|this|break|continue|switch|case|default|do|yield|static|import|export|from|delete|instanceof|void)\b|\b(pm|console|Math|JSON|Object|Array|Boolean|Number|String|Date|RegExp|Promise|Map|Set)\b/g;

/** Very small, dependency-free JS syntax highlighter (comments/strings/numbers/keywords/globals) for read-only script previews. */
function highlightJs(code) {
  const escaped = escapeHtml(code);
  return escaped.replace(JS_HIGHLIGHT_PATTERN, (match, comment, str, num, keyword, globalName) => {
    if (comment) return `<span class="tok-comment">${match}</span>`;
    if (str) return `<span class="tok-string">${match}</span>`;
    if (num) return `<span class="tok-number">${match}</span>`;
    if (keyword) return `<span class="tok-keyword">${match}</span>`;
    if (globalName) return `<span class="tok-global">${match}</span>`;
    return match;
  });
}

/** Renders `code` as syntax-highlighted HTML into the element with `id`, keeping the raw text (for copy/download) in a data attribute. */
function setCode(id, code) {
  const el = $(id);
  el.dataset.raw = code;
  el.innerHTML = highlightJs(code);
}

/** Reads back the raw (unhighlighted) text previously set via setCode(). */
function getCode(id) {
  return $(id).dataset.raw || "";
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function renderOperations(list) {
  const container = $("operation-list");
  container.innerHTML = "";
  for (const op of list) {
    const row = document.createElement("div");
    row.className = "operation-row";
    row.innerHTML = `<span class="method-badge method-${op.method.toLowerCase()}">${op.method.toUpperCase()}</span>${op.path}${op.summary ? "  # " + op.summary : ""}`;
    row.addEventListener("click", () => selectOperation(op));
    container.appendChild(row);
  }
}

function populateMethodFilter(list) {
  const select = $("method-filter");
  select.innerHTML = '<option value="">All methods</option>';
  const methods = [...new Set(list.map((op) => op.method.toLowerCase()))].sort();
  for (const method of methods) {
    const option = document.createElement("option");
    option.value = method;
    option.textContent = method.toUpperCase();
    select.appendChild(option);
  }
}

function applyFilters() {
  const term = $("search-input").value.toLowerCase();
  const method = $("method-filter").value;
  renderOperations(
    operations.filter(
      (op) =>
        (!method || op.method.toLowerCase() === method) &&
        (op.path.toLowerCase().includes(term) || op.method.toLowerCase().includes(term) || (op.summary || "").toLowerCase().includes(term))
    )
  );
}

async function selectOperation(op) {
  selectedOp = op;
  document.querySelectorAll(".operation-row").forEach((r) => r.classList.remove("selected"));
  $("script-section").classList.remove("hidden");
  $("selected-endpoint").value = `${op.method.toUpperCase()} ${op.path}`;
  $("status-input").value = op.autoStatus !== undefined ? op.autoStatus : "200";
  await generateScript();
}

async function generateScript() {
  if (!selectedOp) return;
  try {
    setStatus($("script-status"), "Generating...", "");
    const { script } = await postJson("/api/script", {
      path: selectedOp.path,
      method: selectedOp.method,
      status: $("status-input").value,
    });
    setCode("script-output", script);
    setStatus($("script-status"), "Done.", "ok");
  } catch (err) {
    setStatus($("script-status"), err.message, "error");
  }
}

async function loadSpec() {
  try {
    setStatus($("load-status"), "Loading...", "");
    const useFile = $("load-mode-file").checked;
    let result;
    if (useFile) {
      const file = $("spec-file-input").files[0];
      if (!file) throw new Error("Choose a JSON file first.");
      const specContent = await file.text();
      result = await postJson("/api/load", { specContent, specName: file.name });
    } else {
      result = await postJson("/api/load", {
        spec: $("spec-input").value,
        headerKey: $("header-key-input").value,
        headerValue: $("header-value-input").value,
      });
    }
    const { title, operations: ops } = result;
    operations = ops;
    populateMethodFilter(operations);
    renderOperations(operations);
    $("browse-section").classList.remove("hidden");
    setStatus($("load-status"), `Loaded "${title}" (${operations.length} operations).`, "ok");
  } catch (err) {
    setStatus($("load-status"), err.message, "error");
  }
}

$("load-btn").addEventListener("click", loadSpec);

for (const id of ["spec-input", "header-key-input", "header-value-input"]) {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadSpec();
    }
  });
}

document.querySelectorAll('input[name="load-mode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const useFile = $("load-mode-file").checked;
    $("load-url-fields").classList.toggle("hidden", useFile);
    $("load-file-fields").classList.toggle("hidden", !useFile);
  });
});

$("search-input").addEventListener("input", applyFilters);
$("method-filter").addEventListener("change", applyFilters);

$("regen-btn").addEventListener("click", generateScript);

$("copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(getCode("script-output"));
  setStatus($("script-status"), "Copied to clipboard.", "ok");
});

$("download-btn").addEventListener("click", () => {
  if (!selectedOp) return;
  const blob = new Blob([getCode("script-output")], { type: "text/javascript" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${selectedOp.method}-${selectedOp.path.replace(/[{}/]/g, "-").replace(/-+/g, "-")}.js`;
  a.click();
});

$("export-btn").addEventListener("click", async () => {
  try {
    setStatus($("export-status"), "Exporting...", "");
    const { written, skipped } = await postJson("/api/export", {
      outDir: $("export-outdir").value,
      filter: $("export-filter").value,
    });
    setStatus($("export-status"), `Wrote ${written.length} file(s).${skipped.length ? " Skipped " + skipped.length + "." : ""}`, "ok");
  } catch (err) {
    setStatus($("export-status"), err.message, "error");
  }
});

$("collection-btn").addEventListener("click", async () => {
  try {
    setStatus($("collection-status"), "Generating...", "");
    const { itemCount, outFile } = await postJson("/api/collection", {
      outFile: $("collection-outfile").value,
      name: $("collection-name").value,
      filter: $("collection-filter").value,
    });
    setStatus($("collection-status"), `Wrote ${itemCount} request(s) to ${outFile}.`, "ok");
  } catch (err) {
    setStatus($("collection-status"), err.message, "error");
  }
});

let availableGenerators = [];

function renderGenerators() {
  const container = $("generator-list");
  container.innerHTML = "";
  for (const g of availableGenerators) {
    const row = document.createElement("div");
    row.className = "generator-row";
    row.innerHTML = `<label><input type="checkbox" class="generator-checkbox" value="${g.id}" /> ${g.label}</label>`;

    if (g.params.length > 0) {
      const paramsBox = document.createElement("div");
      paramsBox.className = "generator-params";
      for (const p of g.params) {
        const field = document.createElement("label");
        field.innerHTML = `${p.label}<input type="text" data-generator="${g.id}" data-param="${p.name}" placeholder="${p.default || ""}" />`;
        paramsBox.appendChild(field);
      }
      row.appendChild(paramsBox);
    }

    container.appendChild(row);
  }
}

async function loadGenerators() {
  try {
    const { generators } = await getJson("/api/generators");
    availableGenerators = generators;
    renderGenerators();
  } catch (err) {
    setStatus($("generator-status"), err.message, "error");
  }
}

$("generator-build-btn").addEventListener("click", async () => {
  try {
    const checked = Array.from(document.querySelectorAll(".generator-checkbox:checked")).map((cb) => cb.value);
    if (checked.length === 0) {
      setStatus($("generator-status"), "Pick at least one generator.", "error");
      return;
    }
    const selections = checked.map((id) => {
      const inputs = document.querySelectorAll(`input[data-generator="${id}"]`);
      const params = {};
      inputs.forEach((input) => {
        if (input.value) params[input.dataset.param] = input.value;
      });
      return { id, params };
    });

    setStatus($("generator-status"), "Generating...", "");
    const { script } = await postJson("/api/generators/build", { selections });
    setCode("generator-output", script);
    setStatus($("generator-status"), "Done.", "ok");
  } catch (err) {
    setStatus($("generator-status"), err.message, "error");
  }
});

$("generator-copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(getCode("generator-output"));
  setStatus($("generator-status"), "Copied to clipboard.", "ok");
});

$("generator-download-btn").addEventListener("click", () => {
  const blob = new Blob([getCode("generator-output")], { type: "text/javascript" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pre-request.js";
  a.click();
});

loadGenerators();
