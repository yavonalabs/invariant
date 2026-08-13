/**
 * Provider-Accurate Stripe Webhook Event Mock & Signature Generator
 *
 * Official Spec:
 * https://docs.stripe.com/webhooks/signature
 *
 * Header:
 * Stripe-Signature: t=timestamp,v1=signature
 *
 * Signed Payload:
 * timestamp.rawBody
 */

const crypto = require("crypto");

function generateStripeSignature(rawBodyStr, secret, timestampOverride = null) {
  if (typeof rawBodyStr !== "string") {
    throw new Error("Stripe signature requires raw request body as string");
  }

  if (!secret) {
    throw new Error("Stripe webhook secret is required");
  }

  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  const payloadToSign = `${timestamp}.${rawBodyStr}`;

  const v1Signature = crypto
    .createHmac("sha256", secret)
    .update(payloadToSign)
    .digest("hex");

  return {
    header: `t=${timestamp},v1=${v1Signature}`,
    timestamp,
    v1Signature
  };
}

function normalizeId(value, fallbackPrefix) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return `${fallbackPrefix}_${Date.now()}`;
  }

  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function childId(eventId, prefix) {
  const raw = String(eventId ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");

  if (!raw) {
    return `${prefix}_${Date.now()}`;
  }

  return `${prefix}_${raw}`;
}

module.exports = {
  generateStripeSignature,

  /**
   * Event: payment_intent.succeeded
   */
  generatePaymentIntentSucceeded: (eventId, amount = 5000, triggerFailure = false) => ({
    id: normalizeId(eventId, "evt"),
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: childId(eventId, "pi"),
        object: "payment_intent",
        amount,
        currency: "usd",
        status: "succeeded",
        customer: "cus_yavona_123",
        metadata: triggerFailure
          ? {
              invariant_test: "trigger_db_failure"
            }
          : {}
      }
    }
  }),

  /**
   * Event: charge.refunded
   * Used for out-of-order lifecycle testing.
   */
  generateChargeRefunded: (eventId, amount = 5000) => ({
    id: normalizeId(eventId, "evt"),
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "charge.refunded",
    data: {
      object: {
        id: childId(eventId, "ch"),
        object: "charge",
        amount,
        amount_refunded: amount,
        currency: "usd",
        status: "succeeded",
        refunded: true,
        payment_intent: childId(eventId, "pi")
      }
    }
  })
};
