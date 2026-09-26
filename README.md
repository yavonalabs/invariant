# Invariant (`@yavona/invariant`)

> **Your webhook returned HTTP 200. Did it leave the correct application state?**
> Test Stripe and Razorpay webhook scenarios locally, then observe explicit state assertions through your application’s probe endpoint.

[![GitHub Actions CI](https://github.com/yavonalabs/invariant/actions/workflows/ci.yml/badge.svg)](https://github.com/yavonalabs/invariant/actions)
[![NPM Version](https://img.shields.io/npm/v/@yavona/invariant.svg?style=flat-square&color=blue&cacheSeconds=300&refresh=0.3.0-alpha.2)](https://www.npmjs.com/package/@yavona/invariant)
[![GitHub Stars](https://img.shields.io/github/stars/yavonalabs/invariant?style=flat-square&color=yellow)](https://github.com/yavonalabs/invariant/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat-square)](https://nodejs.org)
[![Website](https://img.shields.io/badge/website-yavonalabs.com-cyan.svg?style=flat-square)](https://yavonalabs.com)

---

## 🚀 Try the Synthetic Payment-State Demo

Compare a flawed and a fixed in-memory payment service using 20 distinct simulated payments, real local HTTP requests, and the same assertion observer used by the CLI. Only the concurrent balance check is executed; this demo does not test signatures, idempotency, or crash recovery. **No runtime package dependencies, Docker, database, or credentials.**

The 20 payments are inputs to one demo check, not the eight configurable webhook scenarios below. To test your application, you supply a read-only state endpoint (the **probe**) and a JavaScript condition (the **assertion**). Invariant records state before delivery (the **baseline**) and samples afterward for the configured **observation window**.

```bash
npx @yavona/invariant@alpha demo
```

---

## Invariant by Yavona Labs

Invariant is an open-source product from [Yavona Labs](https://yavonalabs.com), an independent software studio.

- **See the output:** [Inspect a sample evidence report](https://yavonalabs.com/evidence/invariant/report.html), generated against a deliberately flawed SQLite example with synthetic data. It is not a customer case study.
- **Start with your app:** [Request free 30-minute guided setup](https://yavonalabs.com/services/#guided-setup). We assess fit and help start one check in your local or synthetic staging environment. Completing integration may take longer; this is setup assistance, not an audit. Sessions are arranged subject to availability.
- **Get engineering help:** [Discuss a $299 payment-flow check](https://yavonalabs.com/services/#payment-flow-check): one flow, one provider, up to three applicable scenarios, written findings, and a walkthrough. Scope, prerequisites, and timing are agreed before payment; implementation is excluded.
- **Need a deeper review?** [Explore the $995 audit and $2,500 audit with reference patch](https://yavonalabs.com/services/). The CLI remains free; paid services add application-specific engineering work.

Share only sanitized context when requesting help, never credentials or customer data.

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

## ⚡ Express.js Probe Starter Snippet

Adapt this illustrative probe endpoint to expose the test state from your local Express app:

```javascript
// Express.js Backend Starter (/api/db-state)
app.get('/api/db-state', async (req, res) => {
  // Block probe route in production
  if (process.env.NODE_ENV === 'production') return res.status(404).end();

  // Implement this adapter using your ORM/SQL layer and a consistent snapshot.
  // It must read actual state for this isolated fixture, including running work.
  const state = await readPaymentTestSnapshot({ customerId: 'test_customer', currency: 'USD' });
  res.json(state); // customerId, currency, paymentCount, ledgerBalance, pendingJobs, payments
});
```

---

## ⚠️ Important Troubleshooting: Express `express.raw()` Body Parsing Gotcha

If your application uses global `app.use(express.json())`, Stripe webhook signature validation will fail with a signature mismatch error. 

Stripe HMAC verification requires the unparsed raw `Buffer` body. Fix this by using `express.raw()` specifically for your webhook route:

```javascript
// Express.js Webhook Route Setup
app.post(
  '/api/webhook',
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

Start with only the scenarios your application supports. In particular, remove `server_error_resilience` until you implement its failure hook. Generating a config does not implement a probe or integrate the synthetic fixtures with your database.

### 2. Execute Stripe Webhook Invariant Tests
```bash
INVARIANT_WEBHOOK_SECRET=whsec_yavona_secret_12345 npx @yavona/invariant@alpha test payment
```

In PowerShell, set `$env:INVARIANT_WEBHOOK_SECRET = "whsec_yavona_secret_12345"` first, then run `npx @yavona/invariant@alpha test payment`. Use the same local test signing secret in your application. `test payment` uses the config's provider; if changing provider, also update fixture mapping and expected currency.

Commands using `@alpha` select the published alpha. Changes described under **Unreleased** in the changelog require a repository checkout and `node src/index.js` until published. For reproducible evaluations, record the CLI version and pin that version in subsequent commands.

## Probe contract and fixture mapping

Your application must implement `GET /api/db-state` (or the URL you configure). Return a consistent JSON snapshot from your test database, scoped to the same customer and currency as your event:

```json
{"customerId":"test_customer","currency":"USD","paymentCount":0,"ledgerBalance":0,"pendingJobs":0,"payments":[]}
```

These are sample baseline values, not a response to hard-code. `paymentCount` counts relevant payment effects; `ledgerBalance` is an integer in minor units (5000 = USD 50.00); `pendingJobs` includes queued and running work for this fixture. Replace the completion condition if your app uses different semantics. An empty queue alone cannot prove success or exclude delayed retries. Return identity and currency from the scoped data, and expose additional evidence when checking other customers, entitlements, or failed jobs.

The earlier Express snippet illustrates route placement; `readPaymentTestSnapshot` is an adapter you must implement using your database, not a function supplied by Invariant. It must filter by customer/currency and read a consistent snapshot. Do not expose this test endpoint publicly in production. The CLI omits URL query strings from output to protect sensitive values; review the configured scope locally. Keep report labels free of customer data.

For a first Stripe check, keep just `duplicate_delivery` in the generated `invariants` array and add this property to that case:

```javascript
generatePayload: (eventId, baseline) => ({
  id: eventId,
  object: "event",
  type: "payment_intent.succeeded",
  livemode: false,
  data: { object: {
    id: "pi_" + eventId,
    object: "payment_intent",
    customer: "test_customer", // Seed this synthetic customer in your app first.
    amount: 5000,
    currency: "usd",
    status: "succeeded"
  } }
}),
```

This minimal fixture may need additional fields required by your handler. `generatePayload(eventId, baseline)` must synchronously return the **complete event**, replacing the built-in fixture. The CLI signs it and reuses it for both duplicate deliveries. Keep payment IDs unique across runs and identical within a duplicate pair. A static `payload` object is also supported, but reusing its IDs across runs can change the expected outcome. For Razorpay, provide its event shape and map `payload.payment.entity` to your own test data; the [reference configuration](examples/sqlite-queue/invariant.config.js) demonstrates both providers.

End-to-end sequence for your already-running test application:

1. Seed the synthetic customer, implement the scoped probe, and configure matching URLs and signing secrets.
2. Run `init`, configure the one duplicate check and fixture above, and match its expected customer, currency, and amount.
3. Run `npx @yavona/invariant@alpha doctor`. Resolve missing probe fields; doctor does not verify fixture mapping or signing compatibility.
4. Run `npx @yavona/invariant@alpha test payment --report-dir ./reports`.
5. Review the HTTP responses and state evidence. A correct run must add one payment and 5000 minor units to the scoped ledger; a correct row count with a wrong amount must fail. Review every report file before sharing.

To exercise a working backend immediately, use the [SQLite walkthrough](examples/sqlite-queue/README.md), which includes the probe, signature verification, workers, and fixture mapping. Building an application's endpoint is a prerequisite, not something `init` performs.

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

The generated starter checks the configured customer and currency, one new payment row, and the exact ledger increase once scoped work has settled. It also checks that rejection scenarios preserve the ledger and count. Adapt these assertions to your own schema and completion evidence; missing required fields produce an error rather than a pass.

Use the [probe and fixture guide](#probe-contract-and-fixture-mapping) for a first Stripe check, or the [SQLite configuration](examples/sqlite-queue/invariant.config.js) for runnable Stripe and Razorpay examples with job completion and rollback evidence. Add assertions for any additional effects you need to verify, such as entitlements or writes to other customers. A scoped balance alone cannot establish that other records were untouched.

Existing configurations are not changed by upgrading the CLI. Generate a fresh config in a separate directory and compare its assertions and field requirements with yours.

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
