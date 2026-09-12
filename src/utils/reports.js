const fs = require("fs");
const path = require("path");

const LIMITS = "Results apply only to the configured fixtures, assertions and sampled observation windows. They do not certify provider settlement, complete queue drainage, or absence of later mutations. Inconclusive means evidence could not establish a result.";
const REVIEW_WARNING = "WARNING: Manually review every report file before sharing. Redaction covers known key patterns and configured secrets only. Free-text fields may contain personal or payment data.";

function createRedactor(config = {}) {
  config = config && typeof config === "object" ? config : {};
  const keys = new Set((Array.isArray(config.reportRedactKeys) ? config.reportRedactKeys : []).filter(k => typeof k === "string").map(k => k.toLowerCase()));
  const headers = config.probeHeaders && typeof config.probeHeaders === "object" ? config.probeHeaders : {};
  const secrets = [config.webhookSecret, ...Object.values(headers)].filter(v => typeof v === "string" && v.length);
  const cleanString = value => {
    for (const secret of secrets) value = value.split(secret).join("[REDACTED]");
    return value.length > 16000 ? value.slice(0, 16000) + "…[TRUNCATED]" : value;
  };
  function redact(value, depth = 0) {
    if (depth > 20) return "[DEPTH LIMIT]";
    if (typeof value === "string") {
      // Decode JSON response bodies so nested sensitive fields are redacted too.
      try { const parsed = JSON.parse(value); if (parsed && typeof parsed === "object") return redact(parsed, depth + 1); } catch { /* Plain text. */ }
      return cleanString(value);
    }
    if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        keys.has(key.toLowerCase()) || /secret|password|token|authorization|cookie|signature|email|phone|contact|card|address|name|ssn|tax|bank|account|routing/i.test(key)
          ? "[REDACTED]" : redact(item, depth + 1)]));
    }
    return value;
  }
  return redact;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.username = ""; url.password = "";
    url.search = ""; url.hash = "";
    return url.toString();
  } catch { return "[INVALID URL]"; }
}

function newReport(kind = "test") {
  return { schemaVersion: 1, kind, version: require("../../package.json").version,
    startedAt: new Date().toISOString(), status: "inconclusive", scope: LIMITS, cases: [] };
}

function xml(value) {
  return String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function renderJUnit(report) {
  const cases = [...report.cases];
  if (report.error) cases.push({ name: "Run setup", status: "inconclusive", error: report.error });
  const count = status => cases.filter(c => c.status === status).length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Invariant ${xml(report.kind)}" tests="${cases.length}" failures="${count("failed")}" errors="${count("inconclusive")}" skipped="${count("not_run") + count("warning")}" time="${(report.durationMs || 0) / 1000}">\n` + cases.map(c => {
    const message = xml(c.error || c.message || c.status);
    let outcome = "";
    if (c.status === "failed") outcome = `<failure message="${message}">${xml(JSON.stringify(c))}</failure>`;
    else if (c.status === "inconclusive") outcome = `<error message="${message}">${xml(JSON.stringify(c))}</error>`;
    else if (c.status !== "passed") outcome = `<skipped message="${message}"/>`;
    return `  <testcase classname="${xml(c.scenario || report.kind)}" name="${xml(c.name)}" time="${(c.durationMs || 0) / 1000}">${outcome}</testcase>`;
  }).join("\n") + "\n</testsuite>\n";
}

function renderHTML(report) {
  const statuses = ["passed", "failed", "inconclusive", "not_run", "warning"];
  const counts = statuses.map(status => `${report.cases.filter(c => c.status === status).length} ${status.replaceAll("_", " ")}`).join(" · ");
  const stateTable = item => {
    if (!item.baselineState || !item.lastState) return "";
    const fields = [...new Set([...Object.keys(item.baselineState), ...Object.keys(item.lastState)])]
      .filter(key => ![item.baselineState[key], item.lastState[key]].some(value => value !== null && typeof value === "object"));
    return `<h3>Observed state</h3><table><thead><tr><th>Field</th><th>Before</th><th>Last observation</th><th>Change</th></tr></thead><tbody>` + fields.slice(0, 40).map(key => {
      const before = item.baselineState[key], after = item.lastState[key];
      const delta = typeof before === "number" && typeof after === "number" ? after - before : null;
      return `<tr><td>${xml(key)}</td><td>${xml(before === undefined ? "—" : before)}</td><td>${xml(after === undefined ? "—" : after)}</td><td>${delta === null ? (before === after ? "Unchanged" : "Changed") : xml(delta > 0 ? `+${delta}` : delta)}</td></tr>`;
    }).join("") + "</tbody></table>";
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Invariant evidence report</title><style>
body{font:16px/1.6 system-ui,sans-serif;color:#192c3a;background:#f4f7fa;margin:0}main{max-width:980px;margin:48px auto;padding:0 24px}h1{font-size:36px;line-height:1.2;margin:10px 0}h2{font-size:19px;margin:0}h3{font-size:15px;margin:20px 0 8px}p{margin:10px 0}.eyebrow{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#496178}.meta{color:#526578}article,.scope{background:white;border:1px solid #d7e1e8;border-radius:10px;padding:22px;margin:18px 0}.status{font-weight:700;text-transform:uppercase;font-size:13px;letter-spacing:.07em}.passed{color:#176347}.failed{color:#b22836}.inconclusive,.warning{color:#895814}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:14px;margin-bottom:20px}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #e1e7ed;overflow-wrap:anywhere}th{color:#496178;font-weight:600;background:#f4f7fa}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2f6;padding:16px;border-radius:6px;font:13px/1.6 ui-monospace,monospace}summary{cursor:pointer;color:#234c78}a{color:#234c78}header{border-bottom:3px solid #244e6d;padding-bottom:24px}footer{font-size:13px;color:#526578;margin:32px 0}@media print{body{background:white}main{margin:0}article{break-inside:avoid}}
</style></head><body><main><header><div class="eyebrow">Yavona Labs · Invariant ${xml(report.version)}</div><h1>${report.kind === "doctor" ? "Setup diagnostic" : "Payment test evidence"}</h1><p class="status ${xml(report.status)}">${xml(report.status)}</p><p class="meta">${xml(report.startedAt)} · ${xml(report.durationMs || 0)}ms</p><p>${xml(counts)}</p><a href="report.json">JSON evidence</a> · <a href="junit.xml">JUnit XML</a></header>
<section class="scope warning" role="note"><h2>Manual review required before sharing</h2><p><strong>${xml(REVIEW_WARNING)}</strong></p></section>
${report.error ? `<article><h2>Run could not complete</h2><p>${xml(report.error)}</p></article>` : ""}
<section class="scope"><h2>Scope and interpretation</h2><p>${xml(report.scope)}</p><p>Reports use automatic field redaction and truncate long strings. Review before sharing; custom business data may still be sensitive.</p>${report.configuration ? `<details><summary>Configuration summary</summary><pre>${xml(JSON.stringify(report.configuration, null, 2))}</pre></details>` : ""}</section>
${report.cases.map(c => `<article><div class="status ${xml(c.status)}">${xml(c.status.replaceAll("_", " "))}</div><h2>${xml(c.name)}</h2><p class="meta">${xml(c.scenario || "")}</p><p>${xml(c.error || c.message || c.description || "")}</p>${c.deliveries?.length ? `<p class="meta">HTTP responses by dispatch order: ${c.deliveries.map(d => xml(d.response?.status ?? "No response")).join(" → ")}${c.samples !== undefined ? ` · ${xml(c.samples)} samples over ${xml(c.observedMs)}ms` : ""}</p>` : ""}${stateTable(c)}<details><summary>Full evidence and observations</summary><pre>${xml(JSON.stringify(c, null, 2))}</pre></details></article>`).join("\n")}
<footer>Generated locally. No report data was uploaded. A passing check is scoped evidence, not a reliability certification.</footer></main></body></html>`;
}

function writeReports(report, directory, config = {}) {
  if (!directory) return null;
  // Warn before writing so a partially written report also carries a terminal warning.
  console.error(REVIEW_WARNING);
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  const output = fs.mkdtempSync(path.join(root, "run-"));
  const redact = createRedactor(config);
  const safe = redact(report);
  // Case names are report labels, not application fields. Keep labels useful in
  // HTML/JUnit while still redacting every nested application field named "name".
  safe.cases.forEach((item, index) => { item.name = redact(report.cases[index].name); });
  safe.reviewWarning = REVIEW_WARNING;
  for (const [name, content] of [["report.json", JSON.stringify(safe, null, 2) + "\n"],
    ["junit.xml", renderJUnit(safe)], ["report.html", renderHTML(safe)]]) {
    fs.writeFileSync(path.join(output, name), content, { flag: "wx", mode: 0o600 });
  }
  return output;
}

module.exports = { newReport, writeReports, renderHTML, renderJUnit, createRedactor, safeUrl };
