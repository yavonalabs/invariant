const stripe = require("../../src/providers/stripe");
const razorpay = require("../../src/providers/razorpay");

const provider = process.env.INVARIANT_PROVIDER || "stripe";
const baseUrl = process.env.INVARIANT_EXAMPLE_URL || "http://127.0.0.1:3001";
const customerId = provider === "stripe" ? "demo_stripe" : "demo_razorpay";
const currency = provider === "stripe" ? "USD" : "INR";
const fields = { customerId: "string", currency: "string", paymentCount: "integer", ledgerBalance: "integer",
  pendingJobs: "integer", failedJobs: "integer", completedJobs: "integer" };

function payload(eventId, failure = false) {
  const event = provider === "stripe" ? stripe.generatePaymentIntentSucceeded(eventId, 5000, failure)
    : razorpay.generatePaymentCaptured(eventId, 5000, failure);
  if (provider === "stripe") event.data.object.customer = customerId;
  else event.payload.payment.entity.notes.customer_id = customerId;
  return event;
}

const settled = state => state.customerId === customerId && state.currency === currency && state.pendingJobs === 0;
const creditOnce = (state, response, baseline) => settled(state) &&
  state.paymentCount === baseline.paymentCount + 1 && state.ledgerBalance === baseline.ledgerBalance + 5000 &&
  state.completedJobs === baseline.completedJobs + 2 && state.failedJobs === baseline.failedJobs;

module.exports = {
  provider, targetUrl: `${baseUrl}/webhooks/${provider}`, probeUrl: `${baseUrl}/probe?customer_id=${customerId}`,
  webhookSecret: process.env.INVARIANT_WEBHOOK_SECRET || "whsec_local_example",
  assertionTimeoutMs: 2500, stabilityWindowMs: 400, requiredProbeFields: fields,
  invariants: [
    { scenario: "duplicate_delivery", name: "One credit across two queued deliveries", expectHttp: 202,
      generatePayload: id => payload(id), assertState: creditOnce },
    { scenario: "concurrent_race_condition", name: "One credit across concurrent queued deliveries", expectHttp: 202,
      generatePayload: id => payload(id), assertState: creditOnce },
    { scenario: "tampered_signature", name: "Invalid signature never enqueues a job", expectHttp: 401,
      generatePayload: id => payload(id), assertState: (state, response, baseline) => settled(state) &&
        state.paymentCount === baseline.paymentCount && state.ledgerBalance === baseline.ledgerBalance &&
        state.completedJobs === baseline.completedJobs && state.failedJobs === baseline.failedJobs },
    { scenario: "server_error_resilience", name: "Worker failure rolls back the ledger write", expectHttp: 202,
      description: "HTTP accepts the job; the injected worker failure must roll back its write and mark the job failed.",
      generatePayload: id => payload(id, true), assertState: (state, response, baseline) => settled(state) &&
        state.failedJobs === baseline.failedJobs + 1 && state.completedJobs === baseline.completedJobs &&
        state.paymentCount === baseline.paymentCount && state.ledgerBalance === baseline.ledgerBalance }
  ]
};
