# Invariant (`@yavona/invariant`)

> **The Business Invariant Layer for Software.**  
> Continuously prove your Stripe & Razorpay webhook implementations satisfy database state post-conditions in under 10 seconds.

[![NPM Version](https://img.shields.io/npm/v/@yavona/invariant.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/@yavona/invariant)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat-square)](https://nodejs.org)
[![Website](https://img.shields.io/badge/website-invariant.dev-cyan.svg?style=flat-square)](https://invariant.dev)

---

## The Problem

Traditional observability tools (Datadog, Sentry, Healthchecks.io) tell you if your server is running or throwing exceptions. **They do not automatically prove business post-conditions unless teams manually instrument those invariants.**

Your payment webhook handler can return **`HTTP 200 OK`** while silently double-charging a customer, corrupting database ledgers on out-of-order refunds, or inserting bad records prior to a 500 crash.

```
Datadog / Sentry    ---> "Is the application throwing runtime exceptions?"
Healthchecks.io     ---> "Did the background process execute?"
INVARIANT           ---> "Did the state mutation satisfy business post-conditions?"
```

**Invariant** continuously tests your backend against real-world provider edge cases (duplicate deliveries, out-of-order lifecycle events, tampered HMAC signatures) and verifies database state invariants (`(state.paymentCount ?? 0) === baseline.paymentCount + 1`).

---

## Quickstart

Run Invariant directly in any Node.js, Python, Java, or Go project with zero installation:

### 1. Initialize Configuration
```bash
npx @yavona/invariant init
```
This generates a clean `invariant.config.js` template in your project directory.

### 2. Execute Stripe Webhook Invariant Tests
```bash
INVARIANT_WEBHOOK_SECRET=whsec_xyz npx @yavona/invariant test stripe-webhooks
```

---

## Terminal Scorecard Output

```text
============================================================
Invariant CLI v0.1.0-alpha.1 — Business Layer
Website: https://invariant.dev
============================================================
[Config] Target Webhook URL: http://localhost:3000/api/webhooks/stripe
[Config] State Probe URL:   http://localhost:3000/api/db-state
[Config] Provider:          STRIPE
[Config] Request Timeout:   5000ms
[Config] Invariants Count:  4

>>> EXECUTING SCENARIO PIPELINE: CLI → Webhook → State Probe → State Assertions

------------------------------------------------------------
[INVARIANT 1/4] idempotency (duplicate_delivery)
 Description: Duplicate webhook events must preserve single DB state record
------------------------------------------------------------
 ↳ Dispatching duplicate webhook payload (ID: evt_inv_duplicate_delivery)...
✅ RESULT: ✔ PASSED — HTTP 200 | DB State Verified
------------------------------------------------------------
[INVARIANT 2/4] security_signature (tampered_signature)
 Description: Invalid provider signature header must be rejected without mutating DB state
------------------------------------------------------------
✅ RESULT: ✔ PASSED — HTTP 401 | DB State Verified
------------------------------------------------------------
[INVARIANT 3/4] lifecycle_ordering (out_of_order)
 Description: Out-of-order refund events prior to payment must not corrupt state ledger
------------------------------------------------------------
✅ RESULT: ✔ PASSED — HTTP 200 | DB State Verified
------------------------------------------------------------
[INVARIANT 4/4] server_error_resilience (server_error_resilience)
 Description: Server 500 errors must be handled gracefully without inserting corrupt DB records
------------------------------------------------------------
✅ RESULT: ✔ PASSED — HTTP 500 | DB State Verified

============================================================
 SUMMARY: 4/4 Invariants Passed (115ms)
 STATUS: 🟢 BUSINESS OUTCOME HEALTHY — All invariants hold true.
============================================================
```

---

## Explicit Scenario Schema (`invariant.config.js`)

```javascript
module.exports = {
  // Target API Webhook Endpoint
  targetUrl: process.env.INVARIANT_TARGET_URL || "http://localhost:3000/api/webhooks/stripe",
  
  // State Assertion Probe Endpoint (Queries backend DB state)
  probeUrl: process.env.INVARIANT_PROBE_URL || "http://localhost:3000/api/db-state",

  // Optional State Reset Endpoint (Resets DB state before each scenario; default: null)
  resetUrl: process.env.INVARIANT_RESET_URL || null,
  
  // Payment Gateway Provider ('stripe' | 'razorpay')
  provider: process.env.INVARIANT_PROVIDER || "stripe",

  // Gateway Signing Secret
  webhookSecret: process.env.INVARIANT_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || "whsec_stripe_secret_12345",

  // Request Timeout & Eventual Consistency Polling Limit in milliseconds
  timeoutMs: Number(process.env.INVARIANT_TIMEOUT_MS || 5000),

  // Explicit Scenario Invariant Specifications
  invariants: [
    {
      scenario: "duplicate_delivery",
      name: "idempotency",
      description: "Duplicate webhook events must preserve single DB state record",
      expectHttp: [200, 202],
      assertState: (state, httpRes, baseline) =>
        (state.paymentCount ?? 0) === ((baseline.paymentCount ?? 0) + 1)
    },
    {
      scenario: "tampered_signature",
      name: "security_signature",
      description: "Invalid provider signature header must be rejected without mutating DB state",
      expectHttp: [400, 401],
      assertState: (state, httpRes, baseline) =>
        (state.paymentCount ?? 0) === (baseline.paymentCount ?? 0)
    },
    {
      scenario: "out_of_order",
      name: "lifecycle_ordering",
      description: "Out-of-order refund events prior to payment must not corrupt state ledger",
      expectHttp: [200, 202, 400],
      assertState: (state, httpRes, baseline) =>
        (state.paymentCount ?? 0) === (baseline.paymentCount ?? 0) &&
        (state.payments || []).every((p) => p.status !== "CORRUPTED")
    },
    {
      scenario: "server_error_resilience",
      name: "server_error_resilience",
      description: "Server 500 errors must be handled gracefully without inserting corrupt DB records",
      expectHttp: [500],
      assertState: (state, httpRes, baseline) =>
        (state.paymentCount ?? 0) === (baseline.paymentCount ?? 0)
    }
  ]
};
```

---

## Testing Locally with the Built-in Mock Server

Invariant includes a zero-dependency mock backend server (`test/mock-server.js`) for instant local testing:

```bash
# Terminal 1: Launch Local Mock Backend Server
npm run mock

# Terminal 2: Test Stripe Webhook Invariants
npm test

# Terminal 3: Test Razorpay Webhook Invariants
npm run test:razorpay
```

---

## GitHub Actions CI/CD Integration

Add Invariant to your `.github/workflows/ci.yml` pipeline:

```yaml
name: Business Correctness CI

on: [push, pull_request]

jobs:
  test-invariants:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Start Server & Run Invariant Tests
        run: |
          npm ci
          npm start &
          npx @yavona/invariant test stripe-webhooks
        env:
          INVARIANT_WEBHOOK_SECRET: ${{ secrets.WEBHOOK_SECRET }}
```

---

## License

MIT © [Yavona Labs](https://invariant.dev)
