/**
 * Invariant CLI Gold-Standard Unified Self-Testing Suite
 * Spawns CLI binary via child_process, tests real HTTP endpoints, exit codes, async queue workers, and consecutive runs.
 */

const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const MOCK_PORT = 3004;
const CLI_PATH = path.resolve(__dirname, "../src/index.js");

let mockDb = { paymentCount: 0, payments: [], mode: "FIXED" };
let receivedEvents = new Set();
let mockServer;

function startMockServer() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${MOCK_PORT}`);

      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        if (url.pathname === "/api/set-mode") {
          const parsed = JSON.parse(body || "{}");
          mockDb.mode = parsed.mode || "FIXED";
          mockDb.paymentCount = 0;
          mockDb.payments = [];
          receivedEvents.clear();
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true }));
        }

        if (url.pathname === "/api/db-state") {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(mockDb));
        }

        // Async Background Queue Webhook (Responds 202 immediately, DB worker writes 1.4s later)
        if (url.pathname === "/api/async-webhook") {
          const sig = req.headers["stripe-signature"];
          if (!sig || sig.includes("tampered")) {
            res.writeHead(401, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Invalid signature" }));
          }

          let event = {};
          try { event = JSON.parse(body || "{}"); } catch (e) {}

          if (event?.data?.object?.metadata?.invariant_test === "trigger_db_failure") {
            if (mockDb.mode === "FLAWED") {
              mockDb.payments.push({ id: "corrupt_row", status: "CORRUPTED" });
              mockDb.paymentCount = mockDb.payments.length;
            }
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "DB Failure" }));
          }

          const eventType = event.type;
          const eventId = event.id;

          if (eventType === "charge.refunded") {
            res.writeHead(202, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ status: "queued_refund" }));
          }

          // Atomic Redis Lock Simulation on HTTP Arrival
          if (mockDb.mode === "FIXED") {
            if (receivedEvents.has(eventId)) {
              res.writeHead(202, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ status: "ignored_duplicate" }));
            }
            receivedEvents.add(eventId);
          }

          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "queued" }));

          // Async background DB worker simulation (1.4s delay)
          setTimeout(() => {
            mockDb.payments.push({ id: `async_${Date.now()}`, eventId, status: "succeeded" });
            mockDb.paymentCount = mockDb.payments.length;
          }, 1400);
          return;
        }

        if (url.pathname === "/api/webhook") {
          const sig = req.headers["stripe-signature"];
          if (!sig || sig.includes("tampered")) {
            res.writeHead(401, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Invalid signature" }));
          }

          let event = {};
          try { event = JSON.parse(body || "{}"); } catch (e) {}

          if (event?.data?.object?.metadata?.invariant_test === "trigger_db_failure") {
            if (mockDb.mode === "FLAWED") {
              mockDb.payments.push({ id: "corrupt_row", status: "CORRUPTED" });
              mockDb.paymentCount = mockDb.payments.length;
            }
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "DB Failure" }));
          }

          const eventType = event.type;
          const eventId = event.id;

          if (eventType === "charge.refunded") {
            if (mockDb.mode === "FLAWED") {
              mockDb.payments.push({ id: `rfnd_${Date.now()}`, status: "CORRUPTED" });
              mockDb.paymentCount = mockDb.payments.length;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ received: true, ignored: true }));
          }

          if (mockDb.mode === "FIXED") {
            const existing = mockDb.payments.find(p => p.eventId === eventId);
            if (existing) {
              res.writeHead(200, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ status: "ignored_duplicate" }));
            }
          }

          mockDb.payments.push({ id: `pay_${Date.now()}`, eventId, status: "succeeded" });
          mockDb.paymentCount = mockDb.payments.length;

          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ status: "success" }));
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      });
    });

    mockServer.listen(MOCK_PORT, () => {
      console.log(`[SelfTest Mock] Listening on http://localhost:${MOCK_PORT}`);
      resolve();
    });
  });
}

function stopMockServer() {
  return new Promise(r => mockServer ? mockServer.close(r) : r());
}

function runCli(args = [], envVars = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        INVARIANT_TARGET_URL: `http://localhost:${MOCK_PORT}/api/webhook`,
        INVARIANT_PROBE_URL: `http://localhost:${MOCK_PORT}/api/db-state`,
        INVARIANT_RESET_URL: "",
        INVARIANT_PROVIDER: "stripe",
        INVARIANT_WEBHOOK_SECRET: "whsec_yavona_secret_12345",
        ...envVars
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", c => stdout += c);
    child.stderr.on("data", c => stderr += c);

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function setMode(mode) {
  return new Promise((resolve) => {
    const req = http.request(`http://localhost:${MOCK_PORT}/api/set-mode`, { method: "POST" }, (res) => {
      resolve();
    });
    req.write(JSON.stringify({ mode }));
    req.end();
  });
}

async function main() {
  await startMockServer();
  console.log(`\n============================================================`);
  console.log(`     RUNNING UNIFIED GOLD-STANDARD CLI SELF-TEST SUITE      `);
  console.log(`============================================================\n`);

  let passed = 0;
  let total = 5;

  // Test 1: CLI Version Command
  console.log(`[SELF-TEST 1/5] Testing CLI Version output...`);
  const res1 = await runCli(["--version"]);
  if (res1.code === 0 && res1.stdout.includes("v0.1.0-alpha.1")) {
    console.log(`✅ [SELF-TEST 1] PASSED — CLI version verified`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 1] FAILED — Exit code ${res1.code}`);
  }

  // Test 2: FIXED Mode Run 1 & Run 2 Consecutive Execution (WITHOUT RESET URL)
  console.log(`\n[SELF-TEST 2/5] Testing FIXED Mode Run 1 & Run 2 Consecutive Execution (NO RESET URL)...`);
  await setMode("FIXED");
  const run1 = await runCli(["test", "stripe-webhooks"]);
  const run2 = await runCli(["test", "stripe-webhooks"]);

  if (run1.code === 0 && run2.code === 0) {
    console.log(`✅ [SELF-TEST 2] PASSED — Consecutive runs without resetUrl succeeded cleanly!`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 2] FAILED — Run 1 code: ${run1.code}, Run 2 code: ${run2.code}`);
  }

  // Test 3: FLAWED Mode Violation Detection
  console.log(`\n[SELF-TEST 3/5] Testing FLAWED Mode Violation Detection...`);
  await setMode("FLAWED");
  const run3 = await runCli(["test", "stripe-webhooks"]);
  if (run3.code === 1 && run3.stdout.includes("BUSINESS INTEGRITY FAILURE DETECTED")) {
    console.log(`✅ [SELF-TEST 3] PASSED — Correctly returned Exit Code 1 on business failure`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 3] FAILED — Unexpected exit code: ${run3.code}`);
  }

  // Test 4: Async Background Queue Worker (202 Accepted + 1.4s Worker DB Write)
  console.log(`\n[SELF-TEST 4/5] Testing Async Background Queue Worker (202 Accepted + 1.4s DB Worker Write)...`);
  await setMode("FIXED");
  const run4 = await runCli(["test", "stripe-webhooks"], {
    INVARIANT_TARGET_URL: `http://localhost:${MOCK_PORT}/api/async-webhook`,
    INVARIANT_ASSERTION_TIMEOUT_MS: "5000"
  });

  if (run4.code === 0 && run4.stdout.includes("4/4 Invariants Passed")) {
    console.log(`✅ [SELF-TEST 4] PASSED — Async queue worker write respected assertionTimeoutMs budget!`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 4] FAILED — Async worker test failed with exit code ${run4.code}`);
    console.log(`   CLI Output:\n${run4.stdout}`);
  }

  // Test 5: Clean CI Output with --ci Flag
  console.log(`\n[SELF-TEST 5/5] Testing --ci Flag ANSI Color Stripping...`);
  const run5 = await runCli(["test", "stripe-webhooks", "--ci"]);
  if (run5.code === 0 && !run5.stdout.includes("\x1b[")) {
    console.log(`✅ [SELF-TEST 5] PASSED — Clean uncolored output produced for CI environments`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 5] FAILED — ANSI escape sequences detected in --ci output`);
  }

  console.log(`\n============================================================`);
  console.log(` SUMMARY: ${passed}/${total} CLI Self-Tests Passed`);
  console.log(` STATUS: ${passed === total ? "🟢 ALL CLI SELF-TESTS PASSED!" : "🔴 SELF-TEST FAILURE"}`);
  console.log(`============================================================\n`);

  await stopMockServer();
  process.exit(passed === total ? 0 : 1);
}

main().catch(console.error);
