/**
 * Invariant Configuration File (invariant.config.js)
 * Website: https://yavonalabs.com
 */

const envResetUrl = process.env.INVARIANT_RESET_URL;
const resetUrl = envResetUrl === undefined
  ? "http://localhost:3001/api/reset-state"
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
