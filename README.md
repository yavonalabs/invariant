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

## ⚠️ Security Best Practice: Protecting Probe Endpoints in Production

State assertion probes (`/api/db-state`, `/api/reset-state`) must **never be exposed in production**.

Add this simple 4-line middleware to your backend application:

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

### Python / FastAPI:
```python
@app.get("/api/db-state")
def get_db_state(request: Request):
    if os.getenv("ENV") == "production":
        raise HTTPException(status_code=404)
    return {"paymentCount": Payment.objects.count()}
```

---

## Failure Injection Contract (`server_error_resilience`)

To test how your application handles database crashes or 500 errors during webhook processing without corrupting DB state, `Invariant` injects provider-accurate failure metadata into test payloads:

* **Stripe**: `data.object.metadata.invariant_test = "trigger_db_failure"`
* **Razorpay**: `payload.payment.entity.notes.invariant_test = "trigger_db_failure"`

Program your local development backend to simulate a database failure when this flag is present:

```javascript
// Express.js Webhook Handler
app.post('/api/webhooks/stripe', async (req, res) => {
  const event = req.body;
  
  // Simulate mid-transaction DB failure when Invariant tests resilience
  if (event.data?.object?.metadata?.invariant_test === 'trigger_db_failure') {
    return res.status(500).json({ error: 'Simulated DB failure' });
  }

  // Normal processing...
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

## Explicit Scenario Schema (`invariant.config.js`)

```javascript
module.exports = {
  targetUrl: process.env.INVARIANT_TARGET_URL || "http://localhost:3000/api/webhooks/stripe",
  probeUrl: process.env.INVARIANT_PROBE_URL || "http://localhost:3000/api/db-state",
  resetUrl: process.env.INVARIANT_RESET_URL || null,
  provider: process.env.INVARIANT_PROVIDER || "stripe",
  webhookSecret: process.env.INVARIANT_WEBHOOK_SECRET || "whsec_stripe_secret_12345",
  timeoutMs: Number(process.env.INVARIANT_TIMEOUT_MS || 5000),

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

## Testing Locally with Built-in Mock Server

```bash
# Terminal 1: Launch Local Mock Backend Server
npm run mock

# Terminal 2: Test Stripe Webhook Invariants
npm test

# Terminal 3: Test Razorpay Webhook Invariants
npm run test:razorpay
```

---

## License

MIT © [Yavona Labs](https://invariant.dev)
