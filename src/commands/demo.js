const http = require("http");
const fmt = require("../utils/formatter");
const { observeAssertion } = require("../utils/assertions");

async function runExample(flawed) {
  const total = 20;
  const amountCents = 5000;
  let balanceCents = 0;
  let received = 0;
  let release;
  const allArrived = new Promise(resolve => { release = resolve; });
  // A barrier forces overlapping reads so the lost update is reproducible.
  const server = http.createServer(async (req, res) => {
    if (req.url === "/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ balanceCents, received }));
    }
    const snapshot = balanceCents;
    received++;
    if (received === total) release();
    await allArrived;
    balanceCents = (flawed ? snapshot : balanceCents) + amountCents;
    res.writeHead(200);
    res.end("OK");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const request = (path, method) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port,
      path, method, agent: false }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(3000, () => req.destroy(new Error("Demo request timed out")));
    req.on("error", reject);
    req.end();
  });
  try {
    const responses = await Promise.all(Array.from({ length: total }, () => request("/webhook", "POST")));
    const assertion = await observeAssertion({
      readState: async () => {
        const response = await request("/state", "GET");
        if (response.status !== 200) throw new Error("Demo probe failed");
        return JSON.parse(response.body);
      },
      assertState: state => state.balanceCents === total * amountCents && state.received === total,
      baselineState: { balanceCents: 0, received: 0 }, httpRes: responses[0],
      assertionTimeoutMs: 800, stabilityWindowMs: 200
    });
    return { assertion, responses, expectedCents: total * amountCents };
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

async function handleDemo() {
  fmt.banner();
  console.log("One scenario: 20 distinct simulated payments updating an in-memory balance.");
  console.log("Uses real local HTTP requests and the CLI assertion observer. No database or payment provider is involved.");
  let demonstrated = true;
  for (const flawed of [true, false]) {
    const { assertion, responses, expectedCents } = await runExample(flawed);
    const okCount = responses.filter(response => response.status === 200).length;
    console.log(flawed ? "\nFLAWED BACKEND" : "\nFIXED BACKEND");
    console.log(`HTTP 200 responses: ${okCount}/${responses.length}`);
    console.log(`Expected balance: $${(expectedCents / 100).toFixed(2)} | Observed: $${((assertion.state?.balanceCents ?? 0) / 100).toFixed(2)}`);
    console.log(assertion.passed ? "[PASS] Concurrent balance assertion" : "[FAIL] Concurrent balance assertion");
    if (assertion.error) console.log(assertion.error.message);
    demonstrated &&= okCount === responses.length && assertion.passed === !flawed &&
      assertion.state?.received === 20 && assertion.state.balanceCents === (flawed ? 5000 : expectedCents);
  }
  console.log("\nScope: sampled concurrent balance checks only. Idempotency, signatures, and crash recovery were not tested.");
  console.log("Test your application: npx @yavona/invariant init");
  if (!demonstrated) process.exitCode = 1;
}

module.exports = { handleDemo };
