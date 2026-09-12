/**
 * Invariant CLI Configuration Initializer
 * Command: npx @yavona/invariant init
 */

const fs = require("fs");
const path = require("path");
const fmt = require("../utils/formatter");

const CONFIG_TEMPLATE = `/**
 * Invariant Configuration File (invariant.config.js)
 * Website: https://yavonalabs.com
 */

const envResetUrl = process.env.INVARIANT_RESET_URL;
const resetUrl = envResetUrl === undefined
  ? null
  : (envResetUrl === "" || envResetUrl === "null" || envResetUrl === "false" ? null : envResetUrl);

module.exports = {
  // Target API Webhook Endpoint
  targetUrl:
    process.env.INVARIANT_TARGET_URL ||
    "http://localhost:3001/api/webhook",

  // State Assertion Probe Endpoint (Queries backend DB state)
  probeUrl:
    process.env.INVARIANT_PROBE_URL ||
    "http://localhost:3001/api/db-state",

  // Optional Reset Endpoint (Resets DB state before each scenario)
  resetUrl: resetUrl,

  // Payment Gateway Provider ('stripe' | 'razorpay')
  provider:
    process.env.INVARIANT_PROVIDER ||
    "stripe",

  // Gateway Signing Secret
  webhookSecret:
    process.env.INVARIANT_WEBHOOK_SECRET ||
    process.env.WEBHOOK_SECRET ||
    "whsec_yavona_secret_12345",

  // HTTP Request Timeout in milliseconds
  httpTimeoutMs: Number(process.env.INVARIANT_HTTP_TIMEOUT_MS || 5000),

  // Full sampled observation window; allow enough time for background workers
  assertionTimeoutMs: Number(process.env.INVARIANT_ASSERTION_TIMEOUT_MS || 5000),

  stabilityWindowMs: 400,

  // Invariant Specifications
  invariants: [
    // -------------------------------------------------------------------------
    // CORE PAYMENT INVARIANTS (Active by default — requires paymentCount / ledger)
    // -------------------------------------------------------------------------
    {
      scenario: "duplicate_delivery",
      name: "idempotency",
      requiredProbeFields: { paymentCount: "integer" },
      description:
        "Duplicate webhook events must preserve single DB state record",
      expectHttp: [200, 202],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.paymentCount) && Number.isSafeInteger(baseline.paymentCount) &&
        state.paymentCount === baseline.paymentCount + 1
    },
    {
      scenario: "tampered_signature",
      name: "security_signature",
      requiredProbeFields: { paymentCount: "integer" },
      description:
        "Invalid provider signature header must be rejected without mutating DB state",
      expectHttp: [400, 401],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.paymentCount) && Number.isSafeInteger(baseline.paymentCount) &&
        state.paymentCount === baseline.paymentCount
    },
    {
      scenario: "out_of_order",
      name: "lifecycle_ordering",
      requiredProbeFields: { paymentCount: "integer", payments: "array" },
      description:
        "Orphan refund must preserve payment count and contain no configured corruption markers",
      expectHttp: [200, 202, 400],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.paymentCount) && Number.isSafeInteger(baseline.paymentCount) &&
        state.paymentCount === baseline.paymentCount &&
        Array.isArray(state.payments) && state.payments.every((p) => p && p.status !== "CORRUPTED")
    },
    {
      scenario: "server_error_resilience",
      name: "server_error_resilience",
      requiredProbeFields: { paymentCount: "integer" },
      description:
        "Injected HTTP 500 must preserve the observed payment count",
      expectHttp: [500],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.paymentCount) && Number.isSafeInteger(baseline.paymentCount) &&
        state.paymentCount === baseline.paymentCount
    }

    // -------------------------------------------------------------------------
    // ADVANCED INVARIANTS (Uncomment when you have configured these probe fields)
    // -------------------------------------------------------------------------
    /*
    ,
    {
      scenario: "concurrent_race_condition",
      name: "queue_concurrency_lock",
      requiredProbeFields: { paymentCount: "integer" },
      description:
        "Simultaneous webhook delivery burst must preserve exact single record under concurrency",
      expectHttp: [200, 202],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.paymentCount) && Number.isSafeInteger(baseline.paymentCount) &&
        state.paymentCount === baseline.paymentCount + 1
    },
    {
      scenario: "partial_refund_bounds",
      name: "refund_bounds_check",
      requiredProbeFields: { refundedAmount: "integer", capturedAmount: "integer" },
      description:
        "Refund amount exceeding captured payment must be rejected without corrupting ledger",
      totalAmount: 5000,
      refundAmount: 8000,
      expectHttp: [400, 422],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.refundedAmount) && Number.isSafeInteger(state.capturedAmount) &&
        state.refundedAmount >= 0 && state.refundedAmount <= state.capturedAmount
    },
    {
      scenario: "subscription_downgrade",
      name: "tier_revocation",
      requiredProbeFields: { userTier: "string", subscriptionStatus: "string" },
      description:
        "Subscription cancellation event must revoke pro tier without orphaned active state",
      expectHttp: [200, 202],
      assertState: (state, httpRes, baseline) =>
        state.userTier === "free" && state.subscriptionStatus === "canceled"
    },
    {
      scenario: "schema_replay_tolerance",
      name: "legacy_schema_safety",
      requiredProbeFields: { corruptRecordsCount: "integer" },
      description:
        "Replaying legacy schema versions must not cause unhandled crashes or corrupt records",
      expectHttp: [200, 202, 400],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.corruptRecordsCount) && state.corruptRecordsCount === 0
    }
    */
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
    console.log(`2. Run ${fmt.bold("npx @yavona/invariant test stripe-webhooks")} to execute invariants testing.\n`);

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: Failed to create 'invariant.config.js': ${err.message}\n`);
    process.exit(2);
  }
}

module.exports = { handleInit };
