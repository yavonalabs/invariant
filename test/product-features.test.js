const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { renderHTML, renderJUnit, createRedactor, writeReports } = require("../src/utils/reports");

const CLI = path.resolve(__dirname, "../src/index.js");
function run(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args, "--ci"], { cwd, env: process.env });
    let output = "";
    child.stdout.on("data", c => { output += c; });
    child.stderr.on("data", c => { output += c; });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Feature test timed out")); }, 30000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test("reports escape executable content and redact configured secrets", () => {
  const redact = createRedactor({ webhookSecret: "whsec-PRIVATE", probeHeaders: { Authorization: "Bearer PRIVATE" }, reportRedactKeys: ["customerName"] });
  const value = redact({ description: "<script>alert(1)</script>", email: "private@example.com",
    nested: { customerName: "Private Person", message: "contains whsec-PRIVATE" }, body: '{"token":"hidden","amount":5000}' });
  assert.equal(value.email, "[REDACTED]");
  assert.equal(value.nested.customerName, "[REDACTED]");
  assert.equal(value.body.token, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(value), /whsec-PRIVATE|private@example/);
  const report = { kind: "test", status: "failed", cases: [{ ...value, status: "failed", error: '<b>"unsafe" & \u0001</b>' }] };
  const html = renderHTML(report);
  assert.doesNotMatch(html, /<script>|<b>"unsafe/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Content-Security-Policy/);
  const junit = renderJUnit(report);
  assert.match(junit, /failures="1"/);
  assert.doesNotMatch(junit, /\u0001|<script>/);
});

test("generated reports redact personal and banking fields across evidence; free text requires explicit redaction", t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "invariant-redaction-"));
  const warning = t.mock.method(console, "error", () => {});
  const personal = { name: "Example Private Person", firstName: "PrivateFirst", LAST_NAME: "PrivateLast",
    ssn: "000-12-3456", taxId: "TAX-PRIVATE-987", bank: "Private Bank", bankAccount: "BANK-987654",
    account_number: "ACCOUNT-123456", routingNumber: "ROUTING-654321" };
  const note = "Contact example@example.test; card 4111111111111111";
  const report = { kind: "test", status: "failed", cases: [{ name: "Duplicate delivery", status: "failed",
    baselineState: { ...personal }, lastState: { customers: [personal], userNote: note },
    observations: [{ state: personal }], deliveries: [{ payload: personal, response: { body: JSON.stringify(personal) } }] }] };
  try {
    assert.equal(writeReports(report, null), null);
    assert.equal(warning.mock.callCount(), 0);
    const directory = writeReports(report, cwd);
    assert.equal(warning.mock.callCount(), 1);
    assert.match(warning.mock.calls[0].arguments[0], /WARNING: Manually review every report file before sharing/);
    for (const filename of ["report.json", "report.html", "junit.xml"]) {
      const content = fs.readFileSync(path.join(directory, filename), "utf8");
      for (const value of Object.values(personal)) assert.ok(!content.includes(value), `${filename} leaked ${value}`);
      assert.match(content, /Duplicate delivery/);
      assert.match(content, /\[REDACTED\]/);
      // Document the boundary honestly: arbitrary free text is not PII-scanned.
      assert.ok(content.includes(note));
    }
    const json = JSON.parse(fs.readFileSync(path.join(directory, "report.json"), "utf8"));
    assert.match(json.reviewWarning, /Free-text fields/);
    assert.match(fs.readFileSync(path.join(directory, "report.html"), "utf8"), /Manual review required before sharing/);
    const explicit = writeReports(report, cwd, { reportRedactKeys: ["userNote"] });
    for (const filename of ["report.json", "report.html", "junit.xml"]) {
      assert.ok(!fs.readFileSync(path.join(explicit, filename), "utf8").includes(note));
    }
    assert.equal(report.cases[0].baselineState.name, personal.name, "report generation must not mutate live state");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("doctor is read-only; test emits classified evidence and real provider headers", async () => {
  const root = fs.realpathSync(os.tmpdir());
  const cwd = fs.mkdtempSync(path.join(root, "invariant-features-"));
  const output = path.join(cwd, "reports");
  const secret = "whsec-private-integration-test";
  let posts = 0;
  let effects = 0;
  let fieldMissing = false;
  let probeDown = false;
  let provider = "stripe";
  const processed = new Set();
  const ids = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/probe") {
      res.writeHead(probeDown ? 503 : 200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ...(fieldMissing ? {} : { count: effects }), email: "private@example.com", note: secret }));
    }
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      posts++;
      const event = JSON.parse(body);
      let valid;
      let id;
      if (provider === "stripe") {
        const parts = Object.fromEntries(String(req.headers["stripe-signature"]).split(",").map(p => p.split("=")));
        valid = parts.v1 === crypto.createHmac("sha256", secret).update(`${parts.t}.${body}`).digest("hex");
        id = event.id;
      } else {
        id = req.headers["x-razorpay-event-id"];
        valid = !!id && req.headers["x-razorpay-signature"] === crypto.createHmac("sha256", secret).update(body).digest("hex");
      }
      ids.push(id);
      if (!valid) { res.writeHead(401); return res.end("bad signature or missing event ID"); }
      if (!processed.has(id)) { effects++; processed.add(id); }
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: true, email: "private@example.com", secret }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  function config(assertion = "state.count === baseline.count + 1", status = "202") {
    fs.writeFileSync(path.join(cwd, "custom.config.js"), `module.exports = {
      provider: '${provider}', targetUrl: '${baseUrl}/webhook', probeUrl: '${baseUrl}/probe', resetUrl: '${baseUrl}/reset',
      webhookSecret: '${secret}', assertionTimeoutMs: 1800, stabilityWindowMs: 200,
      invariants: [{ name: '<script>bad</script>', scenario: 'duplicate_delivery', requiredProbeFields: {count: 'integer'},
        expectHttp: ${status}, assertState: (state, response, baseline) => { return ${assertion}; } }]
    };`);
  }
  // Reset is configured only for doctor; test must never accidentally call it.
  function disableReset() {
    const file = path.join(cwd, "custom.config.js");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(`resetUrl: '${baseUrl}/reset'`, "resetUrl: null"));
  }
  const args = command => [command, "--config", "custom.config.js", "--report-dir", output];
  function latest(result) {
    assert.equal((result.output.match(/WARNING: Manually review every report file before sharing/g) || []).length, 1, result.output);
    const line = result.output.split(/\r?\n/).find(s => s.startsWith("Reports: "));
    assert.ok(line, result.output);
    const directory = line.slice("Reports: ".length);
    const json = fs.readFileSync(path.join(directory, "report.json"), "utf8");
    assert.doesNotMatch(json, /private@example.com|whsec-private-integration-test/);
    return { report: JSON.parse(json), directory, xml: fs.readFileSync(path.join(directory, "junit.xml"), "utf8") };
  }
  try {
    config("(() => { throw new Error('must not execute during doctor'); })()");
    let result = await run(cwd, args("doctor"));
    assert.equal(result.code, 0, result.output);
    assert.equal(posts, 0);
    assert.equal(latest(result).report.kind, "doctor");
    assert.match(result.output, /mappings verified|mappings|fixture mapping/);
    fieldMissing = true;
    result = await run(cwd, args("doctor"));
    assert.equal(result.code, 2, result.output);
    assert.match(result.output, /count: expected integer/);
    assert.equal(posts, 0);
    result = await run(cwd, args("test"));
    assert.equal(result.code, 2, result.output);
    assert.equal(posts, 0);
    assert.equal(latest(result).report.cases[0].status, "not_run");
    fieldMissing = false;

    for (provider of ["stripe", "razorpay"]) {
      config(); disableReset();
      const before = posts;
      result = await run(cwd, args("test"));
      assert.equal(result.code, 0, result.output);
      assert.equal(posts, before + 2);
      assert.ok(ids.at(-1));
      assert.equal(ids.at(-1), ids.at(-2));
      const evidence = latest(result);
      const c = evidence.report.cases[0];
      assert.equal(c.status, "passed");
      assert.equal(c.deliveries.length, 2);
      assert.ok(c.observations.length >= 2);
      assert.equal(c.lastState.count, c.baselineState.count + 1);
      assert.match(evidence.xml, /failures="0" errors="0"/);
    }
    config("false"); disableReset();
    result = await run(cwd, args("test"));
    assert.equal(result.code, 1, result.output);
    assert.equal(latest(result).report.cases[0].status, "failed");
    assert.match(latest(result).xml, /<failure /);

    config("true"); disableReset();
    const blockedOutput = path.join(cwd, "not-a-directory");
    fs.writeFileSync(blockedOutput, "existing file");
    result = await run(cwd, ["test", "--config", "custom.config.js", "--report-dir", blockedOutput]);
    assert.equal(result.code, 2, result.output);
    assert.match(result.output, /REPORT ERROR/);
    assert.match(result.output, /WARNING: Manually review every report file before sharing/);
    assert.doesNotMatch(result.output, /CONFIGURED CHECKS PASSED/);

    config("(() => { throw new Error('broken assertion'); })()"); disableReset();
    result = await run(cwd, args("test"));
    assert.equal(result.code, 1, result.output);
    assert.equal(latest(result).report.cases[0].status, "inconclusive");
    assert.match(latest(result).xml, /<error /);

    config("true", "200"); disableReset();
    result = await run(cwd, args("test"));
    assert.equal(result.code, 1, result.output);
    assert.equal(latest(result).report.cases[0].status, "failed");

    probeDown = true;
    result = await run(cwd, args("test"));
    assert.equal(result.code, 2, result.output);
    assert.equal(latest(result).report.cases[0].status, "not_run");
    assert.match(latest(result).xml, /<skipped /);
    assert.match(latest(result).xml, /<error /);
    probeDown = false;

    config("true", "undefined"); disableReset();
    result = await run(cwd, args("test"));
    assert.equal(result.code, 2, result.output);
    assert.match(latest(result).report.error, /expectHttp/);
    result = await run(cwd, ["doctor", "--report-dir"]);
    assert.equal(result.code, 2);
    result = await run(cwd, ["doctor", "--config", "custom.config.js"]);
    assert.doesNotMatch(result.output, /Manually review every report file/);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    const resolved = fs.realpathSync(cwd);
    assert.equal(path.dirname(resolved), root);
    assert.ok(path.basename(resolved).startsWith("invariant-features-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
