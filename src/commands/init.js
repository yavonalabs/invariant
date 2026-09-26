/**
 * Invariant CLI Configuration Initializer
 * Command: npx @yavona/invariant@alpha init
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

// Adapt these to your isolated fixture and payloads. Amounts are minor units.
const expectedCustomerId = "test_customer";
const expectedCurrency = "USD"; // Use INR for the built-in Razorpay fixtures.
const expectedAmount = 5000;
const paymentFields = { customerId: "string", currency: "string",
  paymentCount: "integer", ledgerBalance: "integer", pendingJobs: "integer" };
const scoped = state => state.customerId === expectedCustomerId && state.currency === expectedCurrency;
// pendingJobs must include queued AND running work for this fixture.
// Replace this with your app's completion evidence if it has different semantics.
// An empty queue alone does not establish successful processing or rule out later retries.
const settled = state => scoped(state) && state.pendingJobs === 0;
const creditOnce = (state, response, baseline) => scoped(baseline) && settled(state) &&
  Number.isSafeInteger(baseline.paymentCount + 1) &&
  Number.isSafeInteger(baseline.ledgerBalance + expectedAmount) &&
  state.paymentCount === baseline.paymentCount + 1 &&
  state.ledgerBalance === baseline.ledgerBalance + expectedAmount;
const unchanged = (state, response, baseline) => scoped(baseline) && settled(state) &&
  state.paymentCount === baseline.paymentCount && state.ledgerBalance === baseline.ledgerBalance;

module.exports = {
  // Target API Webhook Endpoint
  targetUrl:
    process.env.INVARIANT_TARGET_URL ||
    "http://localhost:3001/api/webhook",

  // Implement this GET endpoint in YOUR application; init does not create it.
  // Return a consistent DB snapshot scoped to the fixture customer and currency:
  // { customerId: "test_customer", currency: "USD", paymentCount: 0,
  //   ledgerBalance: 0, pendingJobs: 0, payments: [] }
  // Values must come from real test state, not hard-coded success responses.
  // Keep it local/authenticated, and exclude unrelated writes and customer data.
  // Guide: https://github.com/yavonalabs/invariant#probe-contract-and-fixture-mapping
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
    // CORE PAYMENT INVARIANTS (adapt probe, fixture mapping, and failure hook first)
    // -------------------------------------------------------------------------
    {
      scenario: "duplicate_delivery",
      name: "Duplicate deliveries credit the fixture once",
      requiredProbeFields: paymentFields,
      description:
        "One payment row and the exact ledger increase for the configured customer and currency",
      expectHttp: [200, 202],
      // Add generatePayload(eventId, baseline) here to return YOUR full synthetic
      // provider event synchronously. Map its customer/payment IDs to test data.
      // It replaces the built-in fixture; the CLI signs it and reuses it for duplicates.
      // See the README's complete Stripe mapping example; do not use real events.
      assertState: creditOnce
    },
    {
      scenario: "tampered_signature",
      name: "Invalid signatures preserve the scoped ledger",
      requiredProbeFields: paymentFields,
      description:
        "Reject invalid signatures without changing the scoped payment count or ledger balance",
      expectHttp: [400, 401],
      assertState: unchanged
    },
    {
      scenario: "out_of_order",
      name: "Orphan refunds preserve the scoped ledger",
      requiredProbeFields: { ...paymentFields, payments: "array" },
      description:
        "Orphan refund must preserve scoped count and balance and contain no configured corruption markers",
      expectHttp: [200, 202, 400],
      assertState: (state, httpRes, baseline) =>
        unchanged(state, httpRes, baseline) &&
        Array.isArray(state.payments) && state.payments.every((p) => p && p.status !== "CORRUPTED")
    },
    {
      scenario: "server_error_resilience",
      // Requires an application failure hook. Remove this case until configured.
      // Built-in Stripe marker: data.object.metadata.invariant_test = trigger_db_failure.
      // Razorpay marker: payload.payment.entity.notes.invariant_test = trigger_db_failure.
      // A pre-processing 500 checks rejection only, NOT transaction rollback.
      // For queued failures, adapt expectHttp and assert a recorded failed job;
      // see examples/sqlite-queue for an actual post-write rollback check.
      name: "Injected rejection preserves the scoped ledger",
      requiredProbeFields: paymentFields,
      description:
        "Injected HTTP 500 must preserve the scoped payment count and ledger balance",
      expectHttp: [500],
      assertState: unchanged
    }

    // -------------------------------------------------------------------------
    // ADVANCED INVARIANTS (Uncomment when you have configured these probe fields)
    // -------------------------------------------------------------------------
    /*
    ,
    {
      scenario: "concurrent_race_condition",
      name: "queue_concurrency_lock",
      requiredProbeFields: paymentFields,
      description:
        "Simultaneous webhook delivery burst must preserve exact single record under concurrency",
      expectHttp: [200, 202],
      assertState: creditOnce
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
    console.log("2. Implement the documented probe contract; map synthetic payloads to your fixture and set the expected customer, currency, and amount.");
    console.log("3. Implement the failure hook or remove server_error_resilience until ready.");
    console.log(`4. Run ${fmt.bold("npx @yavona/invariant@alpha doctor")} before ${fmt.bold("npx @yavona/invariant@alpha test payment --report-dir ./reports")}.\n`);

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ ERROR: Failed to create 'invariant.config.js': ${err.message}\n`);
    process.exit(2);
  }
}

module.exports = { handleInit };
