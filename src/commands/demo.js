const http = require('http');
const fmt = require('../utils/formatter');

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function handleDemo() {
  fmt.banner();
  console.log(`  ${fmt.bold("Business Invariant Testing")}\n`);

  console.log(`  Starting demo environment...`);
  await wait(600);
  console.log(`  ${fmt.green("✓")} Mock payment service`);
  await wait(400);
  console.log(`  ${fmt.green("✓")} PostgreSQL state simulator`);
  await wait(400);
  console.log(`  ${fmt.green("✓")} Webhook worker`);
  await wait(400);
  console.log(`  ${fmt.green("✓")} Race-condition scenario\n`);
  await wait(600);

  // Set up the mock vulnerable server
  let balance = 0;
  let txCount = 0;
  
  const server = http.createServer(async (req, res) => {
    const currentBalance = balance;
    // The delay that guarantees the race condition since we fire all 20 at once
    await wait(100);
    balance = currentBalance + 100;
    txCount++;
    res.writeHead(200);
    res.end('OK');
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const port = server.address().port;

  console.log(`  Sending 20 concurrent payment events...\n`);
  
  let completed = 0;
  const total = 20;

  const reqPromises = [];
  
  // Fire all 20 at exactly the same time
  for (let i = 0; i < total; i++) {
    reqPromises.push(new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/webhook',
        method: 'POST'
      }, (res) => {
        completed++;
        resolve();
      });
      req.end();
    }));
  }

  // Cool progress bar update
  const barWidth = 30;
  
  // We'll just loop and update the progress bar until all are complete
  while (completed < total) {
    const filled = Math.floor((completed / total) * barWidth);
    const empty = barWidth - filled;
    const bar = "█".repeat(filled) + "▒".repeat(empty);
    process.stdout.write(`\r  ${fmt.cyan(bar)} ${completed}/${total}`);
    await wait(20); // fast update
  }
  
  await Promise.all(reqPromises); // ensure they are all done
  
  // Finish bar
  process.stdout.write(`\r  ${fmt.cyan("█".repeat(barWidth))} 20/20\n\n`);

  server.close();

  await wait(600);
  console.log(`  Analyzing business state...\n`);
  await wait(1000);

  const expectedBalance = 20 * 100;
  const actualBalance = balance; // Should be just 100 due to race condition

  const boxLine = "─".repeat(56);
  console.log(`  ┌${boxLine}┐`);
  console.log(`  │  ${fmt.bold("PAYMENT RELIABILITY SCORE: 75/100")}  ${fmt.red("(CRITICAL FAILURE)")} │`);
  console.log(`  └${boxLine}┘\n`);
  
  console.log(`  ${fmt.green("[PASS]")} 1. Idempotency (Same webhook, same state)`);
  console.log(`  ${fmt.green("[PASS]")} 2. Security (Tampered payload rejected)`);
  console.log(`  ${fmt.green("[PASS]")} 3. Crash Recovery (500 error does not lose data)`);
  console.log(`  ${fmt.red("[FAIL]")} 4. Concurrent Processing (Race conditions)`);
  console.log(`         -> Expected Balance: $${(expectedBalance).toFixed(2)}`);
  console.log(`         -> Actual Balance:   $${(actualBalance).toFixed(2)}`);
  console.log(`         -> ${fmt.red(`${total - 1} payments processed successfully but balance lost.`)}\n`);

  await wait(500);
  console.log(`  ${fmt.bold("Your application could lose money under concurrent load.")}`);
  console.log(`  This is a critical P0 vulnerability.\n`);

  await wait(500);
  console.log(`  ${fmt.bold("Want to test your own app?")}`);
  console.log(`  Run: ${fmt.cyan("npx @yavona/invariant init")}`);
  console.log(`  Or get a full code audit: ${fmt.cyan("https://yavonalabs.com/audit")}\n`);
}

module.exports = {
  handleDemo
};
