/**
 * Invariant Local Mock Backend
 *
 * This simulates a payment webhook consumer with:
 * - signature verification
 * - idempotent payment recording
 * - state probe endpoint
 * - state reset endpoint
 * - forced server failure support
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
  payments: []
};

function resetState() {
  state = {
    paymentCount: 0,
    payments: []
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
  }
}

function handleStripeEvent(event) {
  const dataObject = event?.data?.object || {};

  if (dataObject?.metadata?.invariant_test === "trigger_db_failure") {
    return {
      status: 500,
      body: {
        error: "Forced DB failure triggered by Invariant test payload"
      }
    };
  }

  if (event.type === "payment_intent.succeeded") {
    upsertPayment(dataObject.id, dataObject.amount, "stripe");

    return {
      status: 200,
      body: {
        received: true
      }
    };
  }

  if (event.type === "charge.refunded") {
    // Out-of-order refunds should not create payment records.
    return {
      status: 200,
      body: {
        received: true,
        ignored: true,
        reason: "refund_without_existing_payment"
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

  if (paymentEntity?.notes?.invariant_test === "trigger_db_failure") {
    return {
      status: 500,
      body: {
        error: "Forced DB failure triggered by Invariant test payload"
      }
    };
  }

  if (event.event === "payment.captured") {
    upsertPayment(paymentEntity.id, paymentEntity.amount, "razorpay");

    return {
      status: 200,
      body: {
        received: true
      }
    };
  }

  if (event.event === "refund.processed") {
    // Out-of-order refunds should not create payment records.
    return {
      status: 200,
      body: {
        received: true,
        ignored: true,
        reason: "refund_without_existing_payment"
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

      if (stripeSignature) {
        if (!verifyStripeSignature(rawBody, stripeSignature)) {
          return sendJson(res, 401, {
            error: "Invalid Stripe signature"
          });
        }

        let event;

        try {
          event = JSON.parse(rawBody || "{}");
        } catch {
          return sendJson(res, 400, {
            error: "Invalid JSON payload"
          });
        }

        const result = handleStripeEvent(event);
        return sendJson(res, result.status, result.body);
      }

      if (razorpaySignature) {
        if (!verifyRazorpaySignature(rawBody, razorpaySignature)) {
          return sendJson(res, 401, {
            error: "Invalid Razorpay signature"
          });
        }

        let event;

        try {
          event = JSON.parse(rawBody || "{}");
        } catch {
          return sendJson(res, 400, {
            error: "Invalid JSON payload"
          });
        }

        const result = handleRazorpayEvent(event);
        return sendJson(res, result.status, result.body);
      }

      return sendJson(res, 400, {
        error: "Missing webhook signature header"
      });
    }

    return sendJson(res, 404, {
      error: "Not found"
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: err.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`\nInvariant mock backend listening on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/api/webhook`);
  console.log(`DB probe endpoint: http://localhost:${PORT}/api/db-state`);
  console.log(`Reset endpoint: http://localhost:${PORT}/api/reset-state\n`);
});
