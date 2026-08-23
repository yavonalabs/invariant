/**
 * Invariant Local Mock Backend
 *
 * This simulates a payment webhook consumer with:
 * - signature verification
 * - idempotent payment recording
 * - state probe endpoint (/api/db-state)
 * - state reset endpoint (/api/reset-state)
 * - forced server failure injection support
 * - refund bounds validation
 * - subscription tier lifecycle updates
 * - legacy schema replay tolerance
 */

const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3001);

const SECRET =
  process.env.INVARIANT_WEBHOOK_SECRET ||
  process.env.WEBHOOK_SECRET ||
  "whsec_yavona_secret_12345";

let state = {
  paymentCount: 0,
  ledgerBalance: 0,
  payments: [],
  userTier: "free",
  subscriptionStatus: "active",
  refundedAmount: 0,
  capturedAmount: 5000,
  corruptRecordsCount: 0
};

function resetState() {
  state = {
    paymentCount: 0,
    ledgerBalance: 0,
    payments: [],
    userTier: "free",
    subscriptionStatus: "active",
    refundedAmount: 0,
    capturedAmount: 5000,
    corruptRecordsCount: 0
  };
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);

  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json)
  });

  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
    });

    req.on("end", () => {
      resolve(data);
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function verifyStripeSignature(rawBody, header) {
  if (!header) {
    return false;
  }

  const parts = {};

  for (const part of header.split(",")) {
    const [key, value] = part.split("=");

    if (key && value) {
      parts[key.trim()] = value.trim();
    }
  }

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return safeCompare(signature, expected);
}

function verifyRazorpaySignature(rawBody, header) {
  if (!header) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(rawBody)
    .digest("hex");

  return safeCompare(header, expected);
}

function upsertPayment(id, amount, provider) {
  if (!id) return;

  const existing = state.payments.find((payment) => payment.id === id);

  if (!existing) {
    state.payments.push({
      id,
      amount,
      provider,
      status: "succeeded"
    });

    state.paymentCount = state.payments.length;
    state.ledgerBalance += amount || 5000;
  }
}

function handleStripeEvent(event) {
  const dataObject = event?.data?.object || {};

  // 1. Failure Injection Scenario
  if (dataObject?.metadata?.invariant_test === "trigger_db_failure") {
    return {
      status: 500,
      body: {
        error: "Forced DB failure triggered by Invariant test payload"
      }
    };
  }

  // 2. Partial Refund Bounds Scenario (Refund 8000 on 5000 captured)
  if (event.type === "charge.refunded") {
    const refundAmount = dataObject.amount_refunded || dataObject.amount || 0;
    const totalCaptured = dataObject.amount || state.capturedAmount || 5000;

    if (refundAmount > totalCaptured) {
      return {
        status: 422,
        body: {
          error: "Refund amount exceeds total captured payment"
        }
      };
    }

    state.refundedAmount += refundAmount;
    return {
      status: 200,
      body: {
        received: true,
        refundedAmount: state.refundedAmount
      }
    };
  }

  // 3. Subscription Downgrade Scenario
  if (event.type === "customer.subscription.deleted") {
    state.userTier = "free";
    state.subscriptionStatus = "canceled";
    return {
      status: 200,
      body: {
        received: true,
        status: "canceled",
        userTier: "free"
      }
    };
  }

  // 4. Schema Replay Tolerance Scenario (Legacy 2019 API version)
  if (event.api_version === "2019-12-03") {
    const chargeId = dataObject.id || "ch_legacy_default";
    const amount = dataObject.amount || 5000;
    upsertPayment(chargeId, amount, "stripe_legacy");
    return {
      status: 200,
      body: {
        received: true,
        legacy_schema: true
      }
    };
  }

  // 5. Payment Intent Succeeded (Idempotent Payment Recording)
  if (event.type === "payment_intent.succeeded") {
    upsertPayment(dataObject.id, dataObject.amount, "stripe");

    return {
      status: 200,
      body: {
        received: true
      }
    };
  }

  return {
    status: 200,
    body: {
      received: true
    }
  };
}

function handleRazorpayEvent(event) {
  const paymentEntity = event?.payload?.payment?.entity || {};
  const refundEntity = event?.payload?.refund?.entity || {};

  // 1. Failure Injection Scenario
  if (paymentEntity?.notes?.invariant_test === "trigger_db_failure") {
    return {
      status: 500,
      body: {
        error: "Forced DB failure triggered by Invariant test payload"
      }
    };
  }

  // 2. Refund Bounds Scenario
  if (event.event === "refund.processed") {
    const refundAmount = refundEntity.amount || 0;
    const totalCaptured = state.capturedAmount || 5000;

    if (refundAmount > totalCaptured) {
      return {
        status: 422,
        body: {
          error: "Refund amount exceeds total captured payment"
        }
      };
    }

    state.refundedAmount += refundAmount;
    return {
      status: 200,
      body: {
        received: true,
        refundedAmount: state.refundedAmount
      }
    };
  }

  // 3. Subscription Downgrade Scenario
  if (event.event === "subscription.cancelled") {
    state.userTier = "free";
    state.subscriptionStatus = "canceled";
    return {
      status: 200,
      body: {
        received: true,
        status: "cancelled",
        userTier: "free"
      }
    };
  }

  // 4. Payment Captured
  if (event.event === "payment.captured") {
    upsertPayment(paymentEntity.id, paymentEntity.amount, "razorpay");

    return {
      status: 200,
      body: {
        received: true
      }
    };
  }

  return {
    status: 200,
    body: {
      received: true
    }
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    const rawBody = await readBody(req);

    if (pathname === "/api/reset-state") {
      if (req.method !== "POST" && req.method !== "GET") {
        return sendJson(res, 405, {
          error: "Method not allowed"
        });
      }

      resetState();

      return sendJson(res, 200, {
        ok: true
      });
    }

    if (pathname === "/api/db-state") {
      if (req.method !== "GET") {
        return sendJson(res, 405, {
          error: "Method not allowed"
        });
      }

      return sendJson(res, 200, state);
    }

    if (pathname === "/api/webhook") {
      if (req.method !== "POST") {
        return sendJson(res, 405, {
          error: "Method not allowed"
        });
      }

      const stripeSignature = req.headers["stripe-signature"];
      const razorpaySignature = req.headers["x-razorpay-signature"];

      let provider = "unknown";
      let isValid = false;

      if (stripeSignature) {
        provider = "stripe";
        isValid = verifyStripeSignature(rawBody, stripeSignature);
      } else if (razorpaySignature) {
        provider = "razorpay";
        isValid = verifyRazorpaySignature(rawBody, razorpaySignature);
      }

      if (!isValid) {
        return sendJson(res, 401, {
          error: "Invalid or missing webhook signature"
        });
      }

      let parsedPayload = {};

      try {
        parsedPayload = JSON.parse(rawBody || "{}");
      } catch {
        return sendJson(res, 400, {
          error: "Invalid JSON payload"
        });
      }

      let eventResult;

      if (provider === "stripe") {
        eventResult = handleStripeEvent(parsedPayload);
      } else if (provider === "razorpay") {
        eventResult = handleRazorpayEvent(parsedPayload);
      } else {
        return sendJson(res, 400, {
          error: "Unsupported provider"
        });
      }

      return sendJson(res, eventResult.status, eventResult.body);
    }

    return sendJson(res, 404, {
      error: "Not found"
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error.message || "Internal server error"
    });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[Mock Backend] Running on http://localhost:${PORT}`);
    console.log(`[Mock Backend] Webhook: http://localhost:${PORT}/api/webhook`);
    console.log(`[Mock Backend] DB Probe: http://localhost:${PORT}/api/db-state`);
    console.log(`[Mock Backend] Reset:    http://localhost:${PORT}/api/reset-state`);
  });
}

module.exports = { server, resetState, state };
