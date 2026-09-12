const stripe = require("../providers/stripe");
const razorpay = require("../providers/razorpay");

function prepareEvent(config, inv, eventId, baselineState) {
 const providerName = config.provider;
 const scenario = String(inv.scenario || "").trim();
    const hasCustomPayload = inv.payload !== undefined || typeof inv.generatePayload === "function";
    const triggerFailure = scenario === "server_error_resilience";

    let payloadObj;

    if (hasCustomPayload) {
      payloadObj = typeof inv.generatePayload === "function"
        ? inv.generatePayload(eventId, baselineState)
        : inv.payload;
    } else if (scenario === "out_of_order") {
      payloadObj =
        providerName === "stripe"
          ? stripe.generateChargeRefunded(eventId, 5000)
          : razorpay.generateRefundProcessed(eventId, 5000);
    } else if (scenario === "partial_refund_bounds") {
      const totalAmount = Number(inv.totalAmount || 5000);
      const refundAmount = Number(inv.refundAmount || 8000);
      payloadObj =
        providerName === "stripe"
          ? stripe.generatePartialRefund(eventId, totalAmount, refundAmount)
          : razorpay.generatePartialRefundProcessed(eventId, totalAmount, refundAmount);
    } else if (scenario === "subscription_downgrade") {
      payloadObj =
        providerName === "stripe"
          ? stripe.generateCustomerSubscriptionDeleted(eventId)
          : razorpay.generateSubscriptionCancelled(eventId);
    } else if (scenario === "schema_replay_tolerance") {
      payloadObj =
        providerName === "stripe"
          ? stripe.generateLegacySchemaPayload(eventId)
          : razorpay.generateLegacySchemaPayload(eventId);
    } else {
      payloadObj =
        providerName === "stripe"
          ? stripe.generatePaymentIntentSucceeded(eventId, 5000, triggerFailure)
          : razorpay.generatePaymentCaptured(eventId, 5000, triggerFailure);
    }

    if (!payloadObj || typeof payloadObj !== "object" || Array.isArray(payloadObj) || typeof payloadObj.then === "function") {
      throw new Error("Payload must be an object; generatePayload must return it synchronously");
    }
    const payloadStr = JSON.stringify(payloadObj);

    const headers = {};

    if (scenario === "tampered_signature") {
      if (providerName === "stripe") {
        headers["Stripe-Signature"] = `t=${Math.floor(Date.now() / 1000)},v1=tampered_signature_hash`;
      } else {
        headers["X-Razorpay-Signature"] = "tampered_signature_hash";
      }
    } else if (providerName === "stripe") {
      const sig = stripe.generateStripeSignature(payloadStr, config.webhookSecret);
      headers["Stripe-Signature"] = sig.header;
    } else {
      const sig = razorpay.generateRazorpaySignature(payloadStr, config.webhookSecret);
      headers["X-Razorpay-Signature"] = sig;
    }

    if (providerName === "razorpay") {
      headers["X-Razorpay-Event-Id"] = typeof payloadObj.event_id === "string" && payloadObj.event_id ? payloadObj.event_id : eventId;
    }
    return { payload: payloadObj, payloadStr, headers };
}

module.exports = { prepareEvent };
