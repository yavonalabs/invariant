# Changelog

## 0.3.0-alpha.1

This alpha makes webhook test outcomes depend on observed application state and explicit expectations. It is a development and staging test tool, not certification of payment correctness or a production audit.

### Added

- `doctor` checks configuration and probe readiness without sending webhooks.
- JSON, HTML, and JUnit evidence reports with separate passed, failed, inconclusive, and not-run outcomes and automatic sensitive-value redaction. Review reports before sharing; redaction cannot cover every application field.
- A SQLite-backed queue example demonstrating duplicate delivery, signature rejection, transaction rollback, and restart behavior for Stripe and Razorpay.
- Voluntary setup-help and first-run feedback links to public GitHub issue templates.
- Expanded redaction for name, SSN, tax, bank, account, and routing fields; mandatory-review reminders in terminal output, HTML, and JSON. Free-text PII still requires manual review or explicit field redaction with `reportRedactKeys`.

### Changed

- Assertions must return booleans, including asynchronous assertions. Missing or invalid assertions no longer silently pass.
- State is observed across the configured timeout and stability window. A later regression fails the check; probe errors and timeouts are inconclusive. Runs may take longer.
- Probe responses and required fields are validated. HTTP response expectations are checked independently of state assertions.
- State reset is disabled by default. Configure a reset only for an isolated test environment where it is appropriate.
- Razorpay duplicate deliveries share an `X-Razorpay-Event-Id` header.
- The demo uses real local HTTP deliveries and observed state instead of fabricated scores.

### Upgrade

Install with `npm install -g @yavona/invariant@alpha`. Generate a fresh configuration in a separate directory with `invariant init`, compare it with your existing configuration, and run `invariant doctor` before testing. Check explicit response expectations, boolean assertions, required probe fields, and timing budgets. Keep secrets and customer data out of public feedback.

The SQLite example requires a repository checkout and Python; it is not bundled in the npm CLI package.
