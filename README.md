# Invariant (`@yavona/invariant`)

> **The Business Invariant Layer for Software.**  
> Continuously prove your Stripe & Razorpay webhook implementations satisfy database state post-conditions in under 10 seconds.

[![NPM Version](https://img.shields.io/npm/v/@yavona/invariant.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/@yavona/invariant)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat-square)](https://nodejs.org)
[![Website](https://img.shields.io/badge/website-invariant.dev-cyan.svg?style=flat-square)](https://invariant.dev)

---

## What Invariant Is (and Isn't)

**Invariant is NOT a simple HTTP event trigger tool like `stripe trigger`.**

`stripe trigger` dispatches webhooks to your application with zero verification of what happens inside your database.

**Invariant is a Business Invariant Assertion Engine.** It queries your application's state probe endpoint (`/api/db-state`) to mathematically prove that your backend state mutations satisfied business post-conditions—even across async Redis/BullMQ queue workers.

```
Datadog / Sentry    ---> "Is the application throwing runtime exceptions?"
Stripe CLI trigger  ---> "Did the webhook HTTP request get sent?"
INVARIANT           ---> "Did the database mutation satisfy business post-conditions?"
```

---

## ⚠️ Security Best Practice: Protecting Probe Endpoints in Production

State assertion probes (`/api/db-state`, `/api/reset-state`) must **never be exposed in production**.

Add this 4-line middleware to your backend:

### Node.js / Express.js:
```javascript
// Block Invariant dev endpoints in production
app.use(['/api/db-state', '/api/reset-state'], (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).end();
  }
  next();
});
```

---

## Quickstart

Run Invariant directly in any Node.js, Python, Java, or Go project with zero installation:

### 1. Initialize Configuration
```bash
npx @yavona/invariant init
```

### 2. Execute Stripe Webhook Invariant Tests
```bash
INVARIANT_WEBHOOK_SECRET=whsec_xyz npx @yavona/invariant test stripe-webhooks
```

---

## Rich Real-World Invariant Assertions (`invariant.config.js`)

Invariant supports rich, arbitrary multi-table JSON state assertions against your application's probe endpoint:

```javascript
module.exports = {
  targetUrl: process.env.INVARIANT_TARGET_URL || "http://localhost:3000/api/webhooks/stripe",
  probeUrl: process.env.INVARIANT_PROBE_URL || "http://localhost:3000/api/db-state",
  resetUrl: process.env.INVARIANT_RESET_URL || null,
  provider: process.env.INVARIANT_PROVIDER || "stripe",
  webhookSecret: process.env.INVARIANT_WEBHOOK_SECRET || "whsec_stripe_secret_12345",
  httpTimeoutMs: Number(process.env.INVARIANT_HTTP_TIMEOUT_MS || 5000),
  assertionTimeoutMs: Number(process.env.INVARIANT_ASSERTION_TIMEOUT_MS || 5000),

  invariants: [
    {
      scenario: "duplicate_delivery",
      name: "ledger_idempotency",
      description: "Duplicate webhooks must preserve single payment row and exact ledger balance",
      expectHttp: [200, 202],
      assertState: (state, httpRes, baseline) =>
        (state.paymentCount ?? 0) === ((baseline.paymentCount ?? 0) + 1) &&
        (state.ledgerBalance ?? 0) === ((baseline.ledgerBalance ?? 0) + 5000)
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
      name: "refund_bounds_check",
      description: "Out-of-order refund events prior to payment must not corrupt state ledger",
      expectHttp: [200, 202, 400],
      assertState: (state, httpRes, baseline) =>
        (state.refundedAmount ?? 0) <= (state.capturedAmount ?? 0) &&
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

## Clean Output for CI/CD Pipelines (`--ci` Flag)

Pass `--ci` or set `CI=true` / `INVARIANT_CI=true` in GitHub Actions or GitLab CI to strip ANSI escape codes and ASCII banners for clean log output:

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

      - name: Start App & Run Invariant Tests
        run: |
          npm ci
          npm start &
          npx @yavona/invariant test stripe-webhooks --ci
        env:
          INVARIANT_WEBHOOK_SECRET: ${{ secrets.WEBHOOK_SECRET }}
```

---

## License

MIT © [Yavona Labs](https://invariant.dev)
