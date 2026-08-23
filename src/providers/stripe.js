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
   * Event: charge.refunded (Full Refund)
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
  }),

  /**
   * Event: charge.refunded (Partial / Boundary Exceeding Refund)
   * Default: attempts to refund 8000 out of a 5000 charge to test boundary enforcement.
   */
  generatePartialRefund: (eventId, totalAmount = 5000, refundAmount = 8000) => ({
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
        amount: totalAmount,
        amount_refunded: refundAmount,
        currency: "usd",
        status: refundAmount >= totalAmount ? "succeeded" : "pending",
        refunded: refundAmount >= totalAmount,
        payment_intent: childId(eventId, "pi")
      }
    }
  }),

  /**
   * Event: customer.subscription.deleted
   */
  generateCustomerSubscriptionDeleted: (eventId) => ({
    id: normalizeId(eventId, "evt"),
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: childId(eventId, "sub"),
        object: "subscription",
        customer: "cus_yavona_123",
        status: "canceled",
        canceled_at: Math.floor(Date.now() / 1000)
      }
    }
  }),

  /**
   * Legacy Schema Replay (2019 API version without payment_intent)
   */
  generateLegacySchemaPayload: (eventId) => ({
    id: normalizeId(eventId, "evt"),
    object: "event",
    api_version: "2019-12-03",
    created: Math.floor(Date.now() / 1000) - 86400 * 30,
    livemode: false,
    type: "charge.succeeded",
    data: {
      object: {
        id: childId(eventId, "ch"),
        object: "charge",
        amount: 5000,
        currency: "usd",
        paid: true,
        captured: true,
        source: {
          id: "card_legacy_123",
          brand: "Visa",
          last4: "4242"
        }
      }
    }
  })
};
