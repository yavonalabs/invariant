/**
 * BizAssert Configuration File (`bizassert.config.js`)
 * 
 * Defines business outcome invariants, target webhook endpoints,
 * secret signing keys, and state probe endpoints.
 */

module.exports = {
  // Target API Webhook Endpoint
  targetUrl: "http://localhost:3001/api/webhook",
  
  // State Assertion Probe Endpoint (Queries backend DB state)
  probeUrl: "http://localhost:3001/api/db-state",
  
  // Payment Gateway Provider
  provider: "razorpay", // 'razorpay' | 'stripe' | 'paddle' | 'lemonsqueezy'

  // Gateway Signing Secret
  webhookSecret: "whsec_yavona_secret_12345",

  // Business Outcome Invariants Specification
  invariants: [
    {
      name: "idempotency",
      description: "Duplicate webhook events must preserve single DB state record",
      assert: (state) => state.paymentCount === 1
    },
    {
      name: "security_signature",
      description: "Tampered or invalid signatures must be rejected cleanly (HTTP 401)",
      assert: (lastHttpResponse) => lastHttpResponse.status === 401
    },
    {
      name: "database_rollback",
      description: "Mid-transaction server crashes must not leave corrupt state",
      assert: (state, lastHttpResponse) => lastHttpResponse.status === 500
    }
  ]
};
