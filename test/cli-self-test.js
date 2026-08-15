const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const pkg = require("../package.json");

const CLI_PATH = path.resolve(__dirname, "../src/index.js");
const MOCK_PORT = 3004;

let mockServer;
let mockMode = "fixed";
let mockDb = { payments: [], paymentCount: 0, ledgerBalance: 0 };
let receivedEvents = new Set();

function startMockServer() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        const url = new URL(req.url, `http://localhost:${MOCK_PORT}`);

        if (url.pathname === "/api/set-mode") {
          try {
            const data = JSON.parse(body);
            mockMode = data.mode;
            mockDb = { payments: [], paymentCount: 0, ledgerBalance: 0 };
            receivedEvents.clear();
          } catch (e) {}
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true }));
        }

        if (url.pathname === "/api/reset") {
          mockDb = { payments: [], paymentCount: 0, ledgerBalance: 0 };
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

          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "accepted_in_queue" }));

          // Async DB Worker Delay
          setTimeout(() => {
            const eventId = event.id || "evt_async_123";
            if (!receivedEvents.has(eventId)) {
              receivedEvents.add(eventId);
              mockDb.payments.push({ id: `pay_${Date.now()}`, eventId, status: "succeeded" });
              mockDb.paymentCount = mockDb.payments.length;
            }
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

          const eventId = event.id || "evt_default";

          if (event.data?.object?.metadata?.invariant_test === "trigger_db_failure") {
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Internal Server Error" }));
          }

          if (mockMode === "flawed") {
            // Flawed backend ignores idempotency check
            mockDb.payments.push({ id: `pay_${Date.now()}`, eventId, status: "succeeded" });
            mockDb.paymentCount = mockDb.payments.length;
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ status: "success" }));
          }

          // Fixed backend checks idempotency
          if (receivedEvents.has(eventId)) {
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
  if (res1.code === 0 && res1.stdout.includes(`v${pkg.version}`)) {
    console.log(`✅ [SELF-TEST 1] PASSED — CLI version verified`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 1] FAILED — Exit code ${res1.code}`);
  }

  // Test 2: FIXED Mode Run 1 & Run 2 Consecutive Execution (Without Reset URL)
  console.log(`\n[SELF-TEST 2/5] Testing FIXED Mode Run 1 & Run 2 Consecutive Execution (NO RESET URL)...`);
  await setMode("fixed");
  const res2a = await runCli(["test", "stripe-webhooks"]);
  const res2b = await runCli(["test", "stripe-webhooks"]);

  if (res2a.code === 0 && res2b.code === 0) {
    console.log(`✅ [SELF-TEST 2] PASSED — Consecutive runs without resetUrl succeeded cleanly!`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 2] FAILED — Run 1 code: ${res2a.code}, Run 2 code: ${res2b.code}`);
  }

  // Test 3: FLAWED Mode Violation Detection
  console.log(`\n[SELF-TEST 3/5] Testing FLAWED Mode Violation Detection...`);
  await setMode("flawed");
  const res3 = await runCli(["test", "stripe-webhooks"]);
  if (res3.code === 1 && res3.stdout.includes("BUSINESS INTEGRITY FAILURE DETECTED")) {
    console.log(`✅ [SELF-TEST 3] PASSED — Correctly returned Exit Code 1 on business failure`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 3] FAILED — Code: ${res3.code}`);
  }

  // Test 4: Async Background Queue Worker Polling (202 Accepted + 1.4s DB Worker Write)
  console.log(`\n[SELF-TEST 4/5] Testing Async Background Queue Worker (202 Accepted + 1.4s DB Worker Write)...`);
  await setMode("fixed");
  const res4 = await runCli(["test", "stripe-webhooks"], {
    INVARIANT_TARGET_URL: `http://localhost:${MOCK_PORT}/api/async-webhook`,
    INVARIANT_ASSERTION_TIMEOUT_MS: "3000"
  });
  if (res4.code === 0 && res4.stdout.includes("PASSED")) {
    console.log(`✅ [SELF-TEST 4] PASSED — Async queue worker write respected assertionTimeoutMs budget!`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 4] FAILED — Code: ${res4.code}`);
  }

  // Test 5: --ci Flag ANSI Color Stripping
  console.log(`\n[SELF-TEST 5/5] Testing --ci Flag ANSI Color Stripping...`);
  const res5 = await runCli(["test", "stripe-webhooks", "--ci"]);
  if (res5.code === 0 && !res5.stdout.includes("\x1b[")) {
    console.log(`✅ [SELF-TEST 5] PASSED — Clean uncolored output produced for CI environments`);
    passed++;
  } else {
    console.log(`❌ [SELF-TEST 5] FAILED — ANSI colors found in CI output`);
  }

  await stopMockServer();

  console.log(`\n============================================================`);
  console.log(` SUMMARY: ${passed}/${total} CLI Self-Tests Passed`);
  if (passed === total) {
    console.log(` STATUS: 🟢 ALL SELF-TESTS PASSED`);
    process.exit(0);
  } else {
    console.log(` STATUS: 🔴 SELF-TEST FAILURE`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Self-test fatal error:", err);
  process.exit(1);
});
