# Invariant (`@yavona/invariant`)

> **The Business Invariant Layer for Software.**  
> Continuously prove your Stripe & Razorpay webhook implementations satisfy database state post-conditions in under 10 seconds.

[![GitHub Actions CI](https://github.com/yavonalabs/invariant/actions/workflows/ci.yml/badge.svg)](https://github.com/yavonalabs/invariant/actions)
[![NPM Version](https://img.shields.io/npm/v/@yavona/invariant.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/@yavona/invariant)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat-square)](https://nodejs.org)
[![Website](https://img.shields.io/badge/website-yavonalabs.com-cyan.svg?style=flat-square)](https://yavonalabs.com)

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

## ⚡ 2-Minute Express.js Starter Snippet

Add this lightweight probe endpoint to your local Express app to get instant state verification:

```javascript
// Express.js Backend Starter (/api/db-state)
app.get('/api/db-state', async (req, res) => {
  // Block probe route in production
  if (process.env.NODE_ENV === 'production') return res.status(404).end();

  // 💡 NOTE: Replace these calls with your ORM / SQL query layer (Prisma, Drizzle, Mongoose, Knex)
  const paymentCount = await db.payments.count();
  const ledgerBalance = await db.ledger.sum('amount');
  
  res.json({ paymentCount, ledgerBalance });
});
```

---

## ⚠️ Important Troubleshooting: Express `express.raw()` Body Parsing Gotcha

If your application uses global `app.use(express.json())`, Stripe webhook signature validation will fail with a signature mismatch error. 

Stripe HMAC verification requires the unparsed raw `Buffer` body. Fix this by using `express.raw()` specifically for your webhook route:

```javascript
// Express.js Webhook Route Setup
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }), // Preserves raw Buffer for HMAC validation
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Invariant Failure Injection Support
    if (event.data?.object?.metadata?.invariant_test === 'trigger_db_failure') {
      return res.status(500).json({ error: 'Simulated DB failure' });
    }

    // Process webhook...
    res.json({ received: true });
  }
);
```

---

## Quickstart

Run Invariant directly in any Node.js, Python, Java, or Go project with zero installation:

> 💡 **Note**: The `@yavona/invariant` NPM package runs directly against your own local app endpoints (`targetUrl` & `probeUrl`). If you wish to run against our built-in standalone mock server demo (`test/mock-server.js`), clone the repository: `git clone https://github.com/yavonalabs/invariant.git`.

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
# GitHub Actions Config (.github/workflows/ci.yml)
name: CI Suite

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test --ci
```

---

## Developer Validation & Feedback

Trying `@yavona/invariant` in your dev environment? We would love to hear your feedback:
* [Open a Developer Feedback Issue on GitHub](https://github.com/yavonalabs/invariant/issues/new?template=feedback.md)

---

## License

MIT © [Yavona Labs](https://yavonalabs.com)
