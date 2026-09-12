"""Local teaching application: SQLite ledger + persistent job queue, two workers.

Run: python server.py --mode fixed
This server intentionally includes a flawed mode and test-only failure injection.
"""
import argparse
import hashlib
import hmac
import json
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, currency TEXT NOT NULL);
INSERT OR IGNORE INTO customers VALUES ('demo_stripe', 'USD'), ('demo_razorpay', 'INR');
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, payment_id TEXT NOT NULL,
  customer_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL,
  inject_failure INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT
);
CREATE TABLE IF NOT EXISTS processed_payments (
  payment_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id TEXT NOT NULL, event_id TEXT NOT NULL,
  customer_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL
);
"""


def connect(database):
    connection = sqlite3.connect(database, timeout=5, isolation_level=None)
    connection.row_factory = sqlite3.Row
    return connection


def worker(database, mode, stopping):
    connection = connect(database)
    try:
        while not stopping.is_set():
            job = None
            try:
                # Claim one durable job. SQLite serializes writers; the claim is short.
                connection.execute("BEGIN IMMEDIATE")
                job = connection.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY id LIMIT 1").fetchone()
                if job:
                    connection.execute("UPDATE jobs SET status='processing', attempts=attempts+1 WHERE id=?", (job["id"],))
                connection.commit()
                if not job:
                    stopping.wait(0.05)
                    continue
                # Simulate asynchronous work after the HTTP 202 has returned.
                time.sleep(0.25)
                connection.execute("BEGIN IMMEDIATE")
                should_credit = True
                if mode == "fixed":
                    prior = connection.execute("SELECT * FROM processed_payments WHERE payment_id=?", (job["payment_id"],)).fetchone()
                    if prior:
                        if any(prior[k] != job[k] for k in ("customer_id", "amount", "currency")):
                            raise ValueError("Payment identity reused with conflicting details")
                        should_credit = False
                    else:
                        connection.execute("INSERT INTO processed_payments VALUES (?, ?, ?, ?)",
                                           tuple(job[k] for k in ("payment_id", "customer_id", "amount", "currency")))
                if should_credit:
                    connection.execute("INSERT INTO ledger(payment_id,event_id,customer_id,amount,currency) VALUES (?,?,?,?,?)",
                                       tuple(job[k] for k in ("payment_id", "event_id", "customer_id", "amount", "currency")))
                    if mode == "flawed":
                        # Bug: no business-key deduplication, and the ledger commits
                        # before all processing succeeds. A later error cannot undo it.
                        connection.commit()
                    if job["inject_failure"]:
                        raise RuntimeError("Injected failure after ledger write")
                connection.execute("UPDATE jobs SET status='done' WHERE id=?", (job["id"],))
                connection.commit()
            except Exception as error:
                connection.rollback()
                if job:
                    connection.execute("UPDATE jobs SET status='failed', error=? WHERE id=?", (str(error), job["id"]))
                else:
                    print(f"Worker error: {error}", flush=True)
                    stopping.wait(0.2)
    finally:
        connection.close()


def handler_class(database, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, value):
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlparse(self.path)
            if url.path != "/probe":
                return self.reply(404, {"error": "Not found"})
            customer_id = parse_qs(url.query).get("customer_id", [""])[0]
            connection = connect(database)
            try:
                connection.execute("BEGIN")
                customer = connection.execute("SELECT * FROM customers WHERE id=?", (customer_id,)).fetchone()
                if not customer:
                    return self.reply(404, {"error": "Unknown fixture customer"})
                ledger = connection.execute("SELECT COUNT(*) count, COALESCE(SUM(amount),0) balance FROM ledger WHERE customer_id=?", (customer_id,)).fetchone()
                jobs = connection.execute("SELECT status, COUNT(*) count FROM jobs WHERE customer_id=? GROUP BY status", (customer_id,)).fetchall()
                counts = {row["status"]: row["count"] for row in jobs}
                self.reply(200, {"customerId": customer_id, "currency": customer["currency"],
                                 "paymentCount": ledger["count"], "ledgerBalance": ledger["balance"],
                                 "pendingJobs": counts.get("queued", 0) + counts.get("processing", 0),
                                 "failedJobs": counts.get("failed", 0), "completedJobs": counts.get("done", 0)})
            finally:
                connection.rollback()
                connection.close()

        def do_POST(self):
            if self.path not in ("/webhooks/stripe", "/webhooks/razorpay"):
                return self.reply(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024 * 1024:
                    return self.reply(413, {"error": "Expected bounded JSON payload"})
                raw = self.rfile.read(length)
                if self.path.endswith("stripe"):
                    parts = dict(part.split("=", 1) for part in self.headers.get("Stripe-Signature", "").split(",") if "=" in part)
                    timestamp = int(parts.get("t", "0"))
                    expected = hmac.new(secret.encode(), str(timestamp).encode() + b"." + raw, hashlib.sha256).hexdigest()
                    if abs(time.time() - timestamp) > 300 or not hmac.compare_digest(expected, parts.get("v1", "")):
                        return self.reply(401, {"error": "Invalid signature"})
                    event = json.loads(raw)
                    if event["type"] != "payment_intent.succeeded":
                        return self.reply(400, {"error": "Example supports payment_intent.succeeded only"})
                    entity = event["data"]["object"]
                    event_id, customer_id, metadata = event["id"], entity["customer"], entity.get("metadata", {})
                else:
                    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
                    event_id = self.headers.get("X-Razorpay-Event-Id", "")
                    if not event_id or not hmac.compare_digest(expected, self.headers.get("X-Razorpay-Signature", "")):
                        return self.reply(401, {"error": "Invalid signature or missing event ID"})
                    event = json.loads(raw)
                    if event["event"] != "payment.captured":
                        return self.reply(400, {"error": "Example supports payment.captured only"})
                    entity = event["payload"]["payment"]["entity"]
                    metadata = entity.get("notes", {})
                    customer_id = metadata["customer_id"]
                amount = entity["amount"]
                currency = entity["currency"].upper()
                if type(amount) is not int or amount <= 0:
                    return self.reply(400, {"error": "Amount must be positive integer minor units"})
                connection = connect(database)
                try:
                    customer = connection.execute("SELECT * FROM customers WHERE id=?", (customer_id,)).fetchone()
                    if not customer or customer["currency"] != currency:
                        return self.reply(400, {"error": "Customer or currency does not match fixture"})
                    connection.execute("INSERT INTO jobs(event_id,payment_id,customer_id,amount,currency,inject_failure) VALUES (?,?,?,?,?,?)",
                                       (event_id, entity["id"], customer_id, amount, currency,
                                        int(metadata.get("invariant_test") == "trigger_db_failure")))
                finally:
                    connection.close()
                self.reply(202, {"accepted": True})
            except (ValueError, KeyError, TypeError) as error:
                self.reply(400, {"error": str(error)})
            except sqlite3.Error as error:
                self.reply(503, {"error": str(error)})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("fixed", "flawed"), default="fixed")
    parser.add_argument("--port", type=int, default=3001)
    parser.add_argument("--db", default="payments.sqlite")
    args = parser.parse_args()
    import os
    secret = os.environ.get("INVARIANT_WEBHOOK_SECRET", "whsec_local_example")
    database = str(Path(args.db).resolve())
    Path(database).parent.mkdir(parents=True, exist_ok=True)
    connection = connect(database)
    connection.executescript(SCHEMA)
    # One server instance owns this demo database. Recover interrupted claims.
    connection.execute("UPDATE jobs SET status='queued' WHERE status='processing'")
    connection.close()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_class(database, secret))
    stopping = threading.Event()
    workers = [threading.Thread(target=worker, args=(database, args.mode, stopping), daemon=True) for _ in range(2)]
    for thread in workers:
        thread.start()
    print(json.dumps({"ready": True, "port": server.server_address[1], "mode": args.mode, "database": database}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        stopping.set()
        for thread in workers:
            thread.join(timeout=6)


if __name__ == "__main__":
    main()
