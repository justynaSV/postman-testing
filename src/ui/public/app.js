let operations = [];
let selectedOp = null;

const $ = (id) => document.getElementById(id);

function setStatus(el, message, kind) {
  el.textContent = message;
  el.className = "status" + (kind ? " " + kind : "");
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

function renderOperations(list) {
  const container = $("operation-list");
  container.innerHTML = "";
  for (const op of list) {
    const row = document.createElement("div");
    row.className = "operation-row";
    row.innerHTML = `<span class="method-badge">${op.method.toUpperCase()}</span>${op.path}${op.summary ? "  # " + op.summary : ""}`;
    row.addEventListener("click", () => selectOperation(op));
    container.appendChild(row);
  }
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
    $("script-output").value = script;
    setStatus($("script-status"), "Done.", "ok");
  } catch (err) {
    setStatus($("script-status"), err.message, "error");
  }
}

$("load-btn").addEventListener("click", async () => {
  try {
    setStatus($("load-status"), "Loading...", "");
    const { title, operations: ops } = await postJson("/api/load", {
      spec: $("spec-input").value,
      headerKey: $("header-key-input").value,
      headerValue: $("header-value-input").value,
    });
    operations = ops;
    renderOperations(operations);
    $("browse-section").classList.remove("hidden");
    setStatus($("load-status"), `Loaded "${title}" (${operations.length} operations).`, "ok");
  } catch (err) {
    setStatus($("load-status"), err.message, "error");
  }
});

$("search-input").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  renderOperations(
    operations.filter(
      (op) => op.path.toLowerCase().includes(term) || op.method.toLowerCase().includes(term) || (op.summary || "").toLowerCase().includes(term)
    )
  );
});

$("regen-btn").addEventListener("click", generateScript);

$("copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("script-output").value);
  setStatus($("script-status"), "Copied to clipboard.", "ok");
});

$("download-btn").addEventListener("click", () => {
  if (!selectedOp) return;
  const blob = new Blob([$("script-output").value], { type: "text/javascript" });
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
