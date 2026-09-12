# SQLite payment queue reference application

This runnable example uses a real SQLite database, a persistent jobs table, two background worker threads, and provider-format HMAC verification. It has fixed and deliberately flawed implementations of payment processing. The CLI remains dependency-free; the example requires Python 3.10+ with sqlite3 and Node.js 18+.

From the repository root, start the fixed backend:

```sh
python examples/sqlite-queue/server.py --mode fixed --db examples/sqlite-queue/fixed.sqlite
```

In another terminal:

```sh
node src/index.js doctor --config examples/sqlite-queue/invariant.config.js
node src/index.js test --config examples/sqlite-queue/invariant.config.js --report-dir artifacts/fixed --ci
```

Open `report.html` in the reported output directory. The four checks should pass:

1. Two sequential deliveries enqueue two jobs but credit the payment once.
2. Two concurrent deliveries enqueue two jobs but credit the payment once.
3. An invalid signature does not enqueue a job or change the ledger.
4. A worker fails **after executing a ledger insert**. Its transaction rolls back, the ledger remains unchanged, and a failed-job record makes completion observable.

The fourth case deliberately expects HTTP 202, because the HTTP handler accepts the job before a background worker fails. It does not claim an HTTP 500 occurred.

## Compare the flawed implementation

Start a separate database and port:

```sh
python examples/sqlite-queue/server.py --mode flawed --port 3002 --db examples/sqlite-queue/flawed.sqlite
```

PowerShell:

```powershell
$env:INVARIANT_EXAMPLE_URL = "http://127.0.0.1:3002"
node src/index.js test --config examples/sqlite-queue/invariant.config.js --report-dir artifacts/flawed --ci
```

POSIX shells:

```sh
INVARIANT_EXAMPLE_URL=http://127.0.0.1:3002 node src/index.js test --config examples/sqlite-queue/invariant.config.js --report-dir artifacts/flawed --ci
```

Expect three failed assertions and one passing signature check. The flawed worker credits both duplicate jobs and commits the ledger before the injected failure, leaving a partial effect behind.

## Razorpay

The same backend supports `/webhooks/razorpay`, verifies the raw-body signature, and requires `X-Razorpay-Event-Id`.

```powershell
$env:INVARIANT_PROVIDER = "razorpay"
$env:INVARIANT_EXAMPLE_URL = "http://127.0.0.1:3001"
node src/index.js test --config examples/sqlite-queue/invariant.config.js --report-dir artifacts/razorpay --ci
```

On POSIX shells, prefix the command with `INVARIANT_PROVIDER=razorpay INVARIANT_EXAMPLE_URL=http://127.0.0.1:3001` instead. Stripe uses `demo_stripe`/USD; Razorpay uses `demo_razorpay`/INR. Amounts are integer minor units: `5000` means 50.00 in these currencies. The probe reads one fixture customer's ledger and queue counts in a consistent database snapshot.

## Why the fixed version works

Jobs are durably inserted before HTTP acceptance. A short `BEGIN IMMEDIATE` transaction claims each job. The worker then records a payment identity in a table with a primary-key constraint, appends the ledger entry, and completes the job in one transaction. Repeated payment identities with conflicting amount, customer, or currency fail explicitly.

Restarting the single server requeues interrupted processing jobs. Completed payment effects remain protected by the stored identity. Failed jobs remain visible for investigation; this example does not automatically retry them.

There is no reset endpoint. Use a new database file for a clean experiment. Repeated suites work against the existing fixture state because assertions use baselines and generated event/payment IDs. Use separate database files for fixed and flawed runs, and run only one server process per database.

## Automated verification

```sh
npm run test:example
```

Set `PYTHON` to your Python executable if its command is not `python`. The test verifies fixed Stripe and Razorpay behavior, actual partial writes in flawed mode, SQLite persistence, process restart after accepting a job, and duplicate delivery after restart. Temporary servers and databases are cleaned up. Set `INVARIANT_EXAMPLE_REPORTS` to retain reports in a chosen directory.

This is a local teaching fixture, bound to 127.0.0.1. It intentionally includes failure injection and a flawed mode. It is not a production server, a general queue implementation, or evidence of compatibility with PostgreSQL, Redis, or BullMQ. Real provider settlement, refund lifecycles, and subscription behavior are outside its scope.
