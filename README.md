# Invariant (`@yavona/invariant`)

> **Your webhook returned HTTP 200. Did it leave the correct application state?**
> Test Stripe and Razorpay webhook scenarios locally, then observe explicit state assertions through your application’s probe endpoint.

[![GitHub Actions CI](https://github.com/yavonalabs/invariant/actions/workflows/ci.yml/badge.svg)](https://github.com/yavonalabs/invariant/actions)
[![NPM Version](https://img.shields.io/npm/v/@yavona/invariant.svg?style=flat-square&color=blue)](https://www.npmjs.com/package/@yavona/invariant)
[![GitHub Stars](https://img.shields.io/github/stars/yavonalabs/invariant?style=flat-square&color=yellow)](https://github.com/yavonalabs/invariant/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat-square)](https://nodejs.org)
[![Website](https://img.shields.io/badge/website-yavonalabs.com-cyan.svg?style=flat-square)](https://yavonalabs.com)

---

## 🚀 The 60-Second Payment Vulnerability Demo

Compare a flawed and a fixed in-memory payment service using 20 distinct simulated payments, real local HTTP requests, and the same assertion observer used by the CLI. Only the concurrent balance check is executed; this demo does not test signatures, idempotency, or crash recovery. **No runtime package dependencies, Docker, database, or credentials.**

```bash
npx @yavona/invariant@alpha demo
```

---

## What Invariant verifies

Invariant supplies eight synthetic webhook scenarios and evaluates your JavaScript assertions against a JSON state probe. Four core scenarios are enabled by `init`; the other four require additional application-specific fields and are commented out in the generated configuration.

A passing result means the expected HTTP statuses matched and the configured assertion held in sampled observations after convergence, within the configured window. It does **not** establish formal correctness, provider settlement, queue completion, or the absence of later mutations. The probe and assertion define the coverage: counting payment rows alone cannot detect a wrong ledger amount or the wrong customer's entitlement.

There are no direct queue integrations. Background workers are observed indirectly through the state exposed by your application.

## Built-in scenarios and limits

| Scenario | Execution | What to configure or verify |
| :--- | :--- | :--- |
| `duplicate_delivery` | Same event delivered twice sequentially | One payment effect; include ledger amount and customer identity for stronger coverage |
| `tampered_signature` | One event with an invalid signature | Explicit rejection status and unchanged relevant state |
| `out_of_order` | One refund for a payment not created by this scenario | Orphan-refund handling only; no later matching payment is delivered |
| `server_error_resilience` | One event carrying a failure-injection marker | Your application must implement the hook; no automatic crash, retry, or rollback injection |
| `concurrent_race_condition` | Two simultaneous deliveries of the same event | Duplicate effects under this interleaving; not exhaustive concurrency testing |
| `partial_refund_bounds` | Synthetic over-limit refund | Bounds assertion against seeded application state; not a sequence of legitimate partial refunds |
| `subscription_downgrade` | One synthetic cancellation | Both expected tier and cancellation state; seed a matching subscription |
| `schema_replay_tolerance` | One legacy-shaped payload | Your defined compatibility policy; not exhaustive API-version coverage |

Payloads are fixtures with provider-format signatures, not live gateway events. Map customer, payment, and subscription identifiers to your test data using `payload` or synchronous `generatePayload(eventId, baseline)`. A signed synthetic payload does not establish provider acceptance or schema completeness.

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

    // Dev-only pre-processing failure. This does not test transaction rollback.
    if (process.env.NODE_ENV !== 'production' &&
        event.data?.object?.metadata?.invariant_test === 'trigger_db_failure') {
      return res.status(500).json({ error: 'Simulated DB failure' });
    }

    // Process webhook...
    res.json({ received: true });
  }
);
```

---

## Quickstart

**Need help with your first test?** [Open a setup-help issue](https://github.com/yavonalabs/invariant/issues/new?template=setup-help.md). Tell us your framework, provider, CLI version, and where you got stuck. I'll help you configure one payment flow; repository access is not required to start.

**Already tried it?** [Tell us what happened](https://github.com/yavonalabs/invariant/issues/new?template=feedback.md): setup worked, setup got blocked, a check failed, or all configured checks passed. One selection and a sentence are enough. Feedback is optional—even if you only downloaded it or ran the demo.

GitHub issues are public. Share a sanitized summary; omit code, credentials, payment data, private URLs, and full reports. The CLI does not send feedback or open an issue automatically.

Requires Node.js 18+ to run the CLI. The target application can use any language. First-time npx use downloads the package; execution then uses your configured endpoints.

> 💡 **Note**: The `@yavona/invariant` NPM package runs directly against your own local app endpoints (`targetUrl` & `probeUrl`). If you wish to run against our built-in standalone mock server demo (`test/mock-server.js`), clone the repository: `git clone https://github.com/yavonalabs/invariant.git`.

### 1. Initialize Configuration
```bash
npx @yavona/invariant@alpha init
```

Edit the generated URLs, signing secret, assertions, and fixture identifiers for your test environment. Reset is disabled by default. Scope probe queries to this test’s records or use an isolated database; unrelated writes can invalidate aggregate assertions. The ordering example also requires a `payments` array; adapt its illustrative corruption-marker check to your schema.

### 2. Execute Stripe Webhook Invariant Tests
```bash
INVARIANT_WEBHOOK_SECRET=whsec_xyz npx @yavona/invariant@alpha test stripe-webhooks
```

---

## Diagnose setup before sending events

`doctor` loads your trusted JavaScript config and makes a GET request to the state probe. It does not send a webhook, call reset, run an assertion, or invoke a payload generator.

```sh
npx @yavona/invariant@alpha doctor --config invariant.config.js
```

It checks configuration, explicit HTTP expectations, time budgets, the probe response, and declared field types. Signing-secret compatibility and fixture identifiers are reported as unverified because confirming them requires your application or an executed test. A successful diagnostic exits 0 with these limits; setup problems exit 2. It does not certify a payment outcome.

Declare fields globally or on individual invariants:

```javascript
requiredProbeFields: {
  paymentCount: "integer",
  ledgerBalance: "integer",
  "customer.id": "string"
},
// Optional authentication for GET requests to the state probe:
probeHeaders: { Authorization: process.env.INVARIANT_PROBE_TOKEN }
```

Supported field types: `integer` (safe integer), `number` (finite), `string`, `boolean`, `array`, and `object`. Nested paths use dots. If using probeHeaders, set its environment variable to a valid header value; omit probeHeaders when unused. Tests enforce declared fields before dispatch and during observations. For legacy configs without declarations, doctor warns that it cannot infer fields from arbitrary JavaScript.

## Local evidence reports

```sh
npx @yavona/invariant@alpha test payment --config invariant.config.js --report-dir ./reports --ci
npx @yavona/invariant@alpha doctor --config invariant.config.js --report-dir ./reports
```

Each run creates a unique subdirectory containing:

- `report.html`: readable case results, HTTP statuses, before/after state tables, and expandable evidence.
- `report.json`: versioned structured evidence including fixtures, dispatch order, responses, baseline and last state, observation samples, durations, and scope.
- `junit.xml`: CI integration; assertion/HTTP failures use failure entries, inconclusive results use error entries, and unexecuted checks use skipped entries.

A `failed` result means an HTTP expectation or state predicate did not hold. `inconclusive` means an assertion error, probe problem, insufficient stability evidence, or execution failure prevented a result. Neither automatically establishes a root cause or severity. Setup errors leave the remaining cases `not_run`. If report output cannot be written, the command exits 2 rather than silently succeeding.

Reports are opt-in and stay local. Signing secrets, configured probe-header values, common sensitive fields, and `reportRedactKeys` are redacted. Sensitive key patterns include name, SSN, tax, bank, account, routing, email, phone, card, and address (case-insensitive, including compound keys). This intentionally may hide nonsensitive fields with matching names. Report case labels remain visible; do not include customer data in labels. URLs omit credentials and query strings. Add application-specific field names with `reportRedactKeys: ["userNote", "internalReference"]` to redact those fields entirely.

**Manual review is required before sharing every report file or uploading it as an artifact.** The terminal and HTML report display this warning, and JSON includes it. Automatic redaction does not reliably detect personal or payment data embedded in free text, such as a note containing an email or card digits. Use test data and inspect JSON, HTML, and JUnit XML before delivering a client report. The warning is a reminder; the CLI cannot verify that a human completed the review.

Responses are limited to 2 MiB, strings to 16,000 characters, and retained observation records to 200 per case. The report marks truncation; the total sample count remains available. Concurrent request order records dispatch order, not guaranteed server arrival order.

To archive reports in GitHub Actions, add an `actions/upload-artifact` step with `if: always()` and the report directory path to your application's test workflow. The generated files can contain application data even after redaction.

## Real database and background queue example

The [SQLite reference application](examples/sqlite-queue/README.md) provides fixed and deliberately flawed backends, a persistent queue, two worker threads, actual transaction rollback, provider-format signature verification, and customer-scoped probes. It requires Python in addition to Node, with no pip packages or Docker.

Run it from a clone of this repository; it is a reference application rather than part of the npm runtime. The linked guide includes both shell variants and commands to produce before/after reports. Use `node src/index.js` in a clone to try unreleased CLI changes locally.

---

## Custom State Assertions (`invariant.config.js`)

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
        Number.isSafeInteger(state.paymentCount) && Number.isSafeInteger(baseline.paymentCount) &&
        state.paymentCount === baseline.paymentCount + 1 &&
        Number.isSafeInteger(state.ledgerBalance) && Number.isSafeInteger(baseline.ledgerBalance) &&
        state.ledgerBalance === baseline.ledgerBalance + 5000
    },
    {
      scenario: "tampered_signature",
      name: "security_signature",
      description: "Invalid provider signature header must be rejected without mutating DB state",
      expectHttp: [400, 401],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.paymentCount) && Number.isSafeInteger(baseline.paymentCount) &&
        state.paymentCount === baseline.paymentCount
    },
    {
      scenario: "out_of_order",
      name: "refund_bounds_check",
      description: "Out-of-order refund events prior to payment must not corrupt state ledger",
      expectHttp: [200, 202, 400],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.refundedAmount) && Number.isSafeInteger(state.capturedAmount) &&
        state.refundedAmount >= 0 && state.refundedAmount <= state.capturedAmount &&
        Array.isArray(state.payments) && state.payments.every((p) => p && p.status !== "CORRUPTED")
    },
    {
      scenario: "server_error_resilience",
      name: "server_error_resilience",
      description: "Server 500 errors must be handled gracefully without inserting corrupt DB records",
      expectHttp: [500],
      assertState: (state, httpRes, baseline) =>
        Number.isSafeInteger(state.paymentCount) && Number.isSafeInteger(baseline.paymentCount) &&
        state.paymentCount === baseline.paymentCount
    }
  ]
};
```

---

## Observation semantics and migration

- Every invariant requires an `assertState` (or legacy `assert`) function and explicit `expectHttp` status code(s). Invalid configuration exits with code 2 before webhook dispatch.
- Assertions may return a boolean or a Promise of a boolean. Missing assertions, truthy non-booleans, exceptions, and rejected promises cannot pass. Custom callbacks should be side-effect-free; asynchronous callbacks must resolve within the remaining observation budget. Synchronous code that blocks the Node.js event loop cannot be interrupted by this budget.
- `assertionTimeoutMs` (default 5000) is the full observation window after HTTP dispatch. The observer samples approximately every 200ms, plus probe/assertion latency. No new probe starts in the final 200ms; the remaining time is allowed to elapse. It permits initial non-matching samples while workers converge, but a false sample after a true sample fails immediately.
- A pass also requires matching samples spanning `stabilityWindowMs` (default 400). Set the observation window longer than this value plus 200ms and allow additional time for worker completion. A late first match fails if too little stability evidence remains.
- Probe errors, malformed/non-object JSON, assertion errors, or an observation deadline exceeded during a probe/assertion fail the check. A timeout or unavailable probe is incomplete evidence, not proof of a payment defect. HTTP expectation mismatches fail without waiting through the state window.
- Negative assertions (for example, "no write occurred") observe the same full window. Work that finishes afterward or mutations between samples can still be missed. Use test isolation and a window that covers expected retries and processing delays.
- Runs now take longer than the earlier first-match implementation: eight passing scenarios with default windows take at least 40 seconds plus request time. Reduce budgets only when justified by your application's timing.
- Test exit codes: 0 = configured checks passed; 1 = failed or inconclusive cases; 2 = configuration, initial probe/schema, or report-writing error. Failure output includes baseline and last observed state, so keep test probes limited to relevant test data.

The generated reset URL is now null. Configure a reset endpoint explicitly if needed. Existing configs need explicit status expectations, valid boolean assertions, and adequate observation budgets. Default assertions now reject absent required fields, and the subscription example requires both tier revocation **and** cancellation.

To test rollback, inject an actual failure after a write inside the transaction and assert all relevant tables. The starter HTTP 500 hook above only checks pre-processing rejection. To test full ordering/recovery, add application-specific event sequences and replay steps; the current built-ins do not provide those guarantees.

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
      - run: npm test --ci
```

---

## ⭐ Support the Project

If `@yavona/invariant` helped you test your Stripe or Razorpay webhook integration and catch edge cases in local dev, please consider **[giving the repository a Star on GitHub](https://github.com/yavonalabs/invariant)** ⭐ — it helps other backend engineers discover the project and supports ongoing development!

---

## Developer Feedback & Setup Help

We want to understand what happens after you download Invariant. [Share your first-test experience](https://github.com/yavonalabs/invariant/issues/new?template=feedback.md), including if you stopped before testing your application. A failing check is useful feedback even when its cause is still unknown.

For hands-on configuration questions, [ask for help with one payment flow](https://github.com/yavonalabs/invariant/issues/new?template=setup-help.md). Start with your CLI version, framework, provider, and a sanitized description. Both paths are voluntary public GitHub issues; no application access or sensitive data is requested.

---

## License

MIT © [Yavona Labs](https://yavonalabs.com)
