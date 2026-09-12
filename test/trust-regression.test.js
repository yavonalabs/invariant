const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { observeAssertion: observeReal } = require("../src/utils/assertions");

// Deterministic sampling tests; HTTP/CLI tests below retain real clocks.
function observeAssertion(options) {
  let elapsed = 0;
  return observeReal(options, { now: () => elapsed, sleep: async ms => { elapsed += ms; } });
}

const cli = path.resolve(__dirname, "../src/index.js");
const options = {
  readState: async () => ({ count: 1 }),
  assertState: state => state.count === 1,
  baselineState: { count: 0 }, httpRes: { status: 200 },
  assertionTimeoutMs: 750, stabilityWindowMs: 200
};

test("async false cannot pass through Promise truthiness", async () => {
  const result = await observeAssertion({ ...options, assertState: async () => false });
  assert.equal(result.passed, false);
});

test("async true observes the full window and multiple samples", async () => {
  const result = await observeAssertion({ ...options, assertState: async () => true });
  assert.equal(result.passed, true);
  assert.ok(result.samples >= 3);
  assert.ok(result.observedMs >= 740);
});

test("eventual state may converge before the stability period", async () => {
  let reads = 0;
  const result = await observeAssertion({ ...options, readState: async () => ({ count: ++reads > 1 ? 1 : 0 }) });
  assert.equal(result.passed, true);
});

test("a delayed duplicate write fails after an initial matching sample", async () => {
  let reads = 0;
  const result = await observeAssertion({ ...options, readState: async () => ({ count: ++reads > 2 ? 2 : 1 }) });
  assert.equal(result.passed, false);
  assert.match(result.error.message, /regressed/);
  assert.equal(result.state.count, 2);
});

test("a late first match cannot establish stability", async () => {
  let reads = 0;
  const result = await observeAssertion({ ...options, assertState: () => ++reads >= 3 });
  assert.equal(result.passed, false);
  assert.match(result.error.message, /Insufficient/);
});

test("truthy non-booleans, exceptions, and rejected promises fail closed", async () => {
  for (const assertState of [() => "false", () => ({}), () => undefined,
    () => { throw new Error("broken assertion"); }, async () => { throw new Error("rejected assertion"); }]) {
    const result = await observeAssertion({ ...options, assertState });
    assert.equal(result.passed, false);
    assert.ok(result.error);
  }
});

test("hanging async assertion is bounded by the observation deadline", async () => {
  const result = await observeAssertion({ ...options, assertionTimeoutMs: 100,
    assertState: () => new Promise(() => {}) });
  assert.equal(result.passed, false);
  assert.match(result.error.message, /deadline/);
  assert.ok(result.observedMs < 1000);
});

test("probe failure after matching state cannot pass", async () => {
  let reads = 0;
  const result = await observeAssertion({ ...options, readState: async () => {
    if (++reads > 1) throw new Error("probe unavailable");
    return { count: 1 };
  } });
  assert.equal(result.passed, false);
  assert.match(result.error.message, /probe unavailable/);
});

test("an assertion completing beyond the deadline cannot pass", async () => {
  let elapsed = 0;
  let calls = 0;
  const result = await observeReal({ ...options, assertionTimeoutMs: 500, stabilityWindowMs: 100,
    assertState: () => {
      if (++calls > 1) elapsed += 350;
      return true;
    }
  }, { now: () => elapsed, sleep: async ms => { elapsed += ms; } });
  assert.equal(result.passed, false);
  assert.match(result.error.message, /deadline/);
});

function runCli(cwd, args = ["test", "payment", "--ci"]) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd,
      env: { ...process.env, INVARIANT_CI: "true" } });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error("CLI test timed out")); }, 15000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test("CLI rejects invalid configuration before dispatch and verifies real HTTP observations", async () => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, "invariant-trust-"));
  let deliveries = 0;
  let probeValue = { count: 1 };
  let statuses = [200, 200];
  let probeReads = 0;
  let delayedDuplicate = false;
  let streamProbe = false;
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === "/probe") {
      probeReads++;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (streamProbe) {
        const timer = setInterval(() => res.write(" "), 20);
        res.on("close", () => clearInterval(timer));
        return;
      }
      const value = delayedDuplicate ? { count: deliveries === 0 ? 0 : (probeReads > 4 ? 2 : 1) } : probeValue;
      return res.end(JSON.stringify(value));
    }
    res.writeHead(statuses[deliveries % statuses.length]);
    deliveries++;
    res.end("ok");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const base = `targetUrl: '${url}/webhook', probeUrl: '${url}/probe', webhookSecret: 'test-secret',
    assertionTimeoutMs: 2000, stabilityWindowMs: 200`;
  const writeConfig = (invariant, extra = "") => fs.writeFileSync(path.join(directory, "invariant.config.js"),
    `module.exports = { ${base}, ${extra} invariants: [${invariant}] };`);
  const inv = `scenario: 'duplicate_delivery', expectHttp: [200, 202]`;
  try {
    for (const [definition, extra] of [
      [`{ ${inv} }`, ""],
      ["{ scenario: 'duplicate_delivery', assertState: () => true }", ""],
      [`{ ${inv}, assertState: () => true }`, "assertionTimeoutMs: NaN,"],
      [`{ ${inv}, assertState: () => true }`, "stabilityWindowMs: 2100,"],
      ["{ scenario: 'typo', expectHttp: 200, assertState: () => true }", ""]
    ]) {
      writeConfig(definition, extra);
      const result = await runCli(directory);
      assert.equal(result.code, 2, result.output);
      assert.match(result.output, /CONFIG ERROR/);
      assert.equal(deliveries, 0);
    }
    writeConfig(`{ ${inv}, assertState: async state => state.count === 1 }`);
    let result = await runCli(directory);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /CONFIGURED CHECKS PASSED/);
    assert.equal(deliveries, 2);

    for (const definition of [`{ ${inv}, assertState: async () => false }`,
      `{ ${inv}, assertState: () => 'yes' }`, `{ ${inv}, assertState: () => { throw new Error('broken'); } }`]) {
      writeConfig(definition);
      result = await runCli(directory);
      assert.equal(result.code, 1, result.output);
      assert.doesNotMatch(result.output, /CONFIGURED CHECKS PASSED/);
    }

    writeConfig(`{ ${inv}, assertState: state => state.count === 1 }`);
    statuses = [200, 500];
    result = await runCli(directory);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Dup:500/);
    statuses = [200, 200];

    probeValue = null;
    result = await runCli(directory);
    assert.equal(result.code, 2, result.output);
    probeValue = { count: 1 };
    deliveries = 0;
    probeReads = 0;
    delayedDuplicate = true;
    result = await runCli(directory);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /regressed/);
    assert.match(result.output, /Last observed state: {"count":2}/);

    delayedDuplicate = false;
    streamProbe = true;
    writeConfig(`{ ${inv}, assertState: () => true }`, "httpTimeoutMs: 150,");
    result = await runCli(directory);
    assert.equal(result.code, 2, result.output);
    assert.match(result.output, /timed out/);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith("invariant-trust-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test("starter assertions reject absent fields and inconsistent subscription state", () => {
  const config = require("../invariant.config.js");
  for (const inv of config.invariants) assert.equal(inv.assertState({}, {}, {}), false, inv.name);
  const subscription = config.invariants.find(inv => inv.scenario === "subscription_downgrade");
  assert.equal(subscription.assertState({ userTier: "pro", subscriptionStatus: "canceled" }), false);
  assert.equal(subscription.assertState({ userTier: "free", subscriptionStatus: "active" }), false);
  assert.equal(subscription.assertState({ userTier: "free", subscriptionStatus: "canceled" }), true);
});

test("demo reports measured flawed and fixed results without unexecuted passes", async () => {
  const result = await runCli(path.dirname(cli), ["demo", "--ci"]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /\[FAIL\] Concurrent balance assertion/);
  assert.match(result.output, /\[PASS\] Concurrent balance assertion/);
  assert.match(result.output, /Expected balance: \$1000.00 \| Observed: \$50.00/);
  assert.doesNotMatch(result.output, /RELIABILITY SCORE|\[PASS\].*(?:Security|Idempotency|Crash)/);
});
