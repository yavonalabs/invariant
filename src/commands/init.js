/**
 * Command: `npx invariant init`
 * Auto-generates invariant.config.js in developer projects
 */

const fs = require("fs");
const path = require("path");
const fmt = require("../utils/formatter");

const CONFIG_TEMPLATE = `/**
 * Invariant Configuration File (invariant.config.js)
 * Website: https://invariant.dev
 *
 * ⚠️ SECURITY NOTICE:
 * Ensure your backend probe endpoints (/api/db-state, /api/reset-state)
 * are strictly disabled in production environments:
 * 
 *   app.use(['/api/db-state', '/api/reset-state'], (req, res, next) => {
 *     if (process.env.NODE_ENV === 'production') return res.status(404).end();
 *     next();
 *   });
 */

module.exports = {
  // Target API Webhook Endpoint
  targetUrl:
    process.env.INVARIANT_TARGET_URL ||
    "http://localhost:3000/api/webhooks/stripe",

  // State Assertion Probe Endpoint (Queries backend DB state)
  probeUrl:
    process.env.INVARIANT_PROBE_URL ||
    "http://localhost:3000/api/db-state",

  // Optional State Reset Endpoint (Resets DB state before each scenario; default: null)
  resetUrl:
    process.env.INVARIANT_RESET_URL ||
    null,

  // Payment Gateway Provider ('stripe' | 'razorpay')
  provider:
    process.env.INVARIANT_PROVIDER ||
    "stripe",

  // Gateway Signing Secret
  webhookSecret:
    process.env.INVARIANT_WEBHOOK_SECRET ||
    process.env.WEBHOOK_SECRET ||
    "whsec_stripe_secret_12345",

  // HTTP Request Timeout in milliseconds
  httpTimeoutMs: Number(process.env.INVARIANT_HTTP_TIMEOUT_MS || 5000),

  // DB Assertion Eventual Consistency Polling Timeout in milliseconds
  assertionTimeoutMs: Number(process.env.INVARIANT_ASSERTION_TIMEOUT_MS || 5000),

  // Explicit Scenario Invariant Specifications
  invariants: [
    {
      scenario: "duplicate_delivery",
      name: "idempotency",
      description:
        "Duplicate webhook events must preserve single DB state record",
      expectHttp: [200, 202],
      assertState: (state, httpRes, baseline) =>
        (state.paymentCount ?? 0) === ((baseline.paymentCount ?? 0) + 1)
    },
    {
      scenario: "tampered_signature",
      name: "security_signature",
      description:
        "Invalid provider signature header must be rejected without mutating DB state",
      expectHttp: [400, 401],
      assertState: (state, httpRes, baseline) =>
        (state.paymentCount ?? 0) === (baseline.paymentCount ?? 0)
    },
    {
      scenario: "out_of_order",
      name: "lifecycle_ordering",
      description:
        "Out-of-order refund events prior to payment must not corrupt state ledger",
      expectHttp: [200, 202, 400],
      assertState: (state, httpRes, baseline) =>
        (state.paymentCount ?? 0) === (baseline.paymentCount ?? 0) &&
        (state.payments || []).every((p) => p.status !== "CORRUPTED")
    },
    {
      scenario: "server_error_resilience",
      name: "server_error_resilience",
      description:
        "Server 500 errors must be handled gracefully without inserting corrupt DB records",
      expectHttp: [500],
      assertState: (state, httpRes, baseline) =>
        (state.paymentCount ?? 0) === (baseline.paymentCount ?? 0)
    }
  ]
};
`;

function handleInit() {
  fmt.banner();

  const targetPath = path.resolve(process.cwd(), "invariant.config.js");

  if (fs.existsSync(targetPath)) {
    console.log(
      `\n${fmt.yellow("⚠️ WARNING")}: ${fmt.bold("invariant.config.js")} already exists in directory ${process.cwd()}`
    );
    console.log(`No changes were made.\n`);
    process.exit(0);
  }

  try {
    fs.writeFileSync(targetPath, CONFIG_TEMPLATE, "utf8");

    console.log(
      `\n${fmt.green("✔ SUCCESS")}: Generated ${fmt.bold("invariant.config.js")} in your project directory!`
    );

    console.log(`\n${fmt.bold("Next Steps:")}`);
    console.log(
      `1. Open ${fmt.cyan("invariant.config.js")} and customize your targetUrl and probeUrl.`
    );
    console.log(`2. Run ${fmt.bold("npx invariant test stripe-webhooks")} to execute invariants testing.\n`);

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: Failed to create 'invariant.config.js': ${err.message}\n`);
    process.exit(2);
  }
}

module.exports = { handleInit };
