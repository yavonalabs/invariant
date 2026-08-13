/**
 * Provider-Accurate Razorpay Webhook Event Mock & Signature Generator
 * Official Spec: https://razorpay.com/docs/webhooks/validate-test/
 * 
 * Header: X-Razorpay-Signature: HMAC-SHA256(rawBody, secret)
 */

const crypto = require('crypto');

function generateRazorpaySignature(rawBodyStr, secret) {
  return crypto.createHmac('sha256', secret).update(rawBodyStr).digest('hex');
}

module.exports = {
  generateRazorpaySignature,

  // Event 1: Payment Captured
  generatePaymentCaptured: (eventId, amount = 5000, triggerFailure = false) => ({
    entity: "event",
    account_id: "acc_yavona_001",
    event: "payment.captured",
    event_id: eventId || `evt_rzp_${Date.now()}`,
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: `pay_${eventId || Date.now()}`,
          entity: "payment",
          amount: amount,
          currency: "INR",
          status: "captured",
          order_id: `order_${Date.now()}`,
          method: "upi",
          captured: true,
          email: "customer@example.com",
          contact: "+919876543210"
        }
      }
    },
    created_at: Math.floor(Date.now() / 1000),
    trigger_db_failure: triggerFailure
  }),

  // Event 2: Refund Processed (Out of Order Testing)
  generateRefundProcessed: (eventId, amount = 5000) => ({
    entity: "event",
    account_id: "acc_yavona_001",
    event: "refund.processed",
    event_id: eventId || `evt_rfnd_${Date.now()}`,
    contains: ["refund"],
    payload: {
      refund: {
        entity: {
          id: `rfnd_${eventId || Date.now()}`,
          entity: "refund",
          amount: amount,
          currency: "INR",
          payment_id: `pay_${eventId || Date.now()}`,
          status: "processed"
        }
      }
    },
    created_at: Math.floor(Date.now() / 1000)
  })
};
