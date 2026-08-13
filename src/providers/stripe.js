/**
 * Provider-Accurate Stripe Webhook Event Mock & Signature Generator
 * Official Spec: https://docs.stripe.com/webhooks/signature
 * 
 * Header: Stripe-Signature: t=timestamp,v1=signature
 * Signed Payload: timestamp.rawBody
 */

const crypto = require('crypto');

function generateStripeSignature(rawBodyStr, secret, timestampOverride = null) {
  const timestamp = timestampOverride || Math.floor(Date.now() / 1000);
  const payloadToSign = `${timestamp}.${rawBodyStr}`;
  const v1Signature = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');
  return {
    header: `t=${timestamp},v1=${v1Signature}`,
    timestamp,
    v1Signature
  };
}

module.exports = {
  generateStripeSignature,

  // Event 1: Payment Intent Succeeded
  generatePaymentIntentSucceeded: (eventId, amount = 5000, triggerFailure = false) => ({
    id: eventId || `evt_stripe_${Date.now()}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `pi_${eventId || Date.now()}`,
        object: "payment_intent",
        amount: amount,
        currency: "usd",
        status: "succeeded",
        customer: "cus_yavona_123"
      }
    },
    type: "payment_intent.succeeded",
    trigger_db_failure: triggerFailure
  }),

  // Event 2: Charge Refunded (Used for Out-of-Order Lifecycle Testing)
  generateChargeRefunded: (eventId, amount = 5000) => ({
    id: eventId || `evt_refund_${Date.now()}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `ch_refund_${eventId || Date.now()}`,
        object: "charge",
        amount_refunded: amount,
        currency: "usd",
        status: "succeeded",
        refunded: true
      }
    },
    type: "charge.refunded"
  })
};
