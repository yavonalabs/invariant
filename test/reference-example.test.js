const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { sendHttpRequest } = require("../src/utils/http");
const stripe = require("../src/providers/stripe");

const example = path.resolve(__dirname, "../examples/sqlite-queue");
const cli = path.resolve(__dirname, "../src/index.js");
const secret = "whsec_local_example";

async function startServer(database, mode) {
  const child = spawn(process.env.PYTHON || "python", [path.join(example, "server.py"), "--mode", mode, "--port", "0", "--db", database],
    { env: { ...process.env, INVARIANT_WEBHOOK_SECRET: secret }, stdio: ["ignore", "pipe", "pipe"] });
  const ready = await new Promise((resolve, reject) => {
    let output = "", errors = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Example startup timed out: ${errors}`)); }, 15000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.stderr.on("data", chunk => { errors += chunk; });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`Example exited ${code}: ${errors}`)); });
    child.stdout.on("data", chunk => {
      output += chunk;
      const line = output.split(/\r?\n/).find(value => value.startsWith('{"ready":'));
      if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
    });
  });
  return { child, url: `http://127.0.0.1:${ready.port}` };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  await new Promise(resolve => { server.child.once("exit", resolve); server.child.kill(); });
}

async function runSuite(server, provider, directory) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "test", "payment", "--config", path.join(example, "invariant.config.js"), "--report-dir", directory, "--ci"],
      { env: { ...process.env, INVARIANT_PROVIDER: provider, INVARIANT_EXAMPLE_URL: server.url, INVARIANT_WEBHOOK_SECRET: secret } });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Example suite timed out: ${output}`)); }, 60000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => {
      clearTimeout(timer);
      const reportLine = output.split(/\r?\n/).find(line => line.startsWith("Reports: "));
      if (!reportLine) return reject(new Error(output));
      const location = reportLine.slice(9);
      resolve({ code, output, location, report: JSON.parse(fs.readFileSync(path.join(location, "report.json"), "utf8")) });
    });
  });
}

async function state(server) {
  return JSON.parse((await sendHttpRequest(`${server.url}/probe?customer_id=demo_stripe`, "GET")).body);
}

async function settled(server) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await state(server);
    if (value.pendingJobs === 0) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Example queue did not settle");
}

test("real SQLite queue: fixed providers pass, flawed writes fail, interrupted jobs survive restart", async () => {
  const root = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, "invariant-sqlite-"));
  const reports = process.env.INVARIANT_EXAMPLE_REPORTS || path.join(directory, "reports");
  let server;
  try {
    const database = path.join(directory, "fixed.sqlite");
    server = await startServer(database, "fixed");
    for (const provider of ["stripe", "razorpay"]) {
      const result = await runSuite(server, provider, path.join(reports, `fixed-${provider}`));
      assert.equal(result.code, 0, result.output);
      assert.equal(result.report.cases.length, 4);
      assert.ok(result.report.cases.every(item => item.status === "passed"), result.output);
      const rollback = result.report.cases[3];
      assert.equal(rollback.lastState.ledgerBalance, rollback.baselineState.ledgerBalance);
      assert.equal(rollback.lastState.failedJobs, rollback.baselineState.failedJobs + 1);
      console.log(`Verified ${provider} against SQLite: ${result.location}`);
    }
    assert.equal(fs.readFileSync(database).subarray(0, 15).toString(), "SQLite format 3");
    const baseline = await state(server);
    const event = stripe.generatePaymentIntentSucceeded("evt_restart_regression", 5000);
    event.data.object.customer = "demo_stripe";
    const body = JSON.stringify(event);
    const headers = { "Stripe-Signature": stripe.generateStripeSignature(body, secret).header };
    assert.equal((await sendHttpRequest(`${server.url}/webhooks/stripe`, "POST", body, headers)).status, 202);
    await stopServer(server);
    server = await startServer(database, "fixed");
    const afterRestart = await settled(server);
    assert.equal(afterRestart.paymentCount, baseline.paymentCount + 1);
    assert.equal(afterRestart.ledgerBalance, baseline.ledgerBalance + 5000);
    assert.equal((await sendHttpRequest(`${server.url}/webhooks/stripe`, "POST", body, headers)).status, 202);
    const afterDuplicate = await settled(server);
    assert.equal(afterDuplicate.paymentCount, afterRestart.paymentCount);
    assert.equal(afterDuplicate.ledgerBalance, afterRestart.ledgerBalance);
    await stopServer(server);
    server = await startServer(path.join(directory, "flawed.sqlite"), "flawed");
    const flawed = await runSuite(server, "stripe", path.join(reports, "flawed-stripe"));
    assert.equal(flawed.code, 1, flawed.output);
    assert.deepEqual(flawed.report.cases.map(item => item.status), ["failed", "failed", "passed", "failed"]);
    assert.equal(flawed.report.cases[3].lastState.ledgerBalance, flawed.report.cases[3].baselineState.ledgerBalance + 5000);
    console.log(`Verified flawed writes are detected: ${flawed.location}`);
  } finally {
    await stopServer(server);
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), root);
    assert.ok(path.basename(resolved).startsWith("invariant-sqlite-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
