/**
 * Provider-Accurate Razorpay Webhook Event Mock & Signature Generator
 *
 * Official Spec:
 * https://razorpay.com/docs/webhooks/validate-test/
 *
 * Header:
 * X-Razorpay-Signature: HMAC-SHA256(rawBody, secret)
 */

const crypto = require("crypto");

function generateRazorpaySignature(rawBodyStr, secret) {
  if (typeof rawBodyStr !== "string") {
    throw new Error("Razorpay signature requires raw request body as string");
  }

  if (!secret) {
    throw new Error("Razorpay webhook secret is required");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(rawBodyStr)
    .digest("hex");
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
  generateRazorpaySignature,

  /**
   * Event: payment.captured
   */
  generatePaymentCaptured: (eventId, amount = 5000, triggerFailure = false) => ({
    entity: "event",
    account_id: "acc_yavona_001",
    event: "payment.captured",
    event_id: normalizeId(eventId, "evt"),
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: childId(eventId, "pay"),
          entity: "payment",
          amount,
          currency: "INR",
          status: "captured",
          order_id: `order_${Date.now()}`,
          method: "upi",
          captured: true,
          email: "customer@example.com",
          contact: "+919876543210",
          notes: triggerFailure
            ? {
                invariant_test: "trigger_db_failure"
              }
            : {}
        }
      }
    },
    created_at: Math.floor(Date.now() / 1000)
  }),

  /**
   * Event: refund.processed
   * Used for out-of-order lifecycle testing.
   */
  generateRefundProcessed: (eventId, amount = 5000) => ({
    entity: "event",
    account_id: "acc_yavona_001",
    event: "refund.processed",
    event_id: normalizeId(eventId, "evt"),
    contains: ["refund"],
    payload: {
      refund: {
        entity: {
          id: childId(eventId, "rfnd"),
          entity: "refund",
          amount,
          currency: "INR",
          payment_id: childId(eventId, "pay"),
          status: "processed"
        }
      }
    },
    created_at: Math.floor(Date.now() / 1000)
  })
};
