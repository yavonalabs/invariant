const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const CLI_PATH = path.resolve(__dirname, "src/index.js");
let MOCK_PORT = 0;
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
            mockDb.payments.push({ id: `pay_${Date.now()}`, eventId, status: "succeeded" });
            mockDb.paymentCount = mockDb.payments.length;
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ status: "success" }));
          }

          if (receivedEvents.has(eventId)) {
            const existing = mockDb.payments.find(p => p.eventId === eventId);
            if (existing) {
              res.writeHead(200, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ status: "ignored_duplicate" }));
            }
          }

          receivedEvents.add(eventId);
          mockDb.payments.push({ id: `pay_${Date.now()}`, eventId, status: "succeeded" });
          mockDb.paymentCount = mockDb.payments.length;

          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ status: "success" }));
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      });
    });

    mockServer.listen(0, () => {
      MOCK_PORT = mockServer.address().port;
      resolve();
    });
  });
}

function runCli(args = [], envVars = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      cwd: __dirname,
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

async function main() {
  await startMockServer();
  console.log("Mock server running on port:", MOCK_PORT);

  const res2a = await runCli(["test", "stripe-webhooks"]);
  console.log("Res2a code:", res2a.code);
  if (res2a.code !== 0) {
    console.log("Res2a stdout:\n", res2a.stdout);
    console.log("Res2a stderr:\n", res2a.stderr);
  }

  mockServer.close();
}

main();
