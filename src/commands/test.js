/**
 * Command Handler:
 * npx invariant test stripe-webhooks
 * npx invariant test payment
 *
 * Provider-Accurate State Assertion Runner
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

const fmt = require("../utils/formatter");
const razorpay = require("../providers/razorpay");
const stripe = require("../providers/stripe");

const EXIT_SUCCESS = 0;
const EXIT_INTEGRITY_FAIL = 1;
const EXIT_CONFIG_ERROR = 2;

const SUPPORTED_PROVIDERS = ["stripe", "razorpay"];
const POLL_INTERVAL_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeScenario(value) {
  return String(value || "").trim();
}

function scenarioKey(value, index) {
  const clean = normalizeScenario(value).replace(/[^a-zA-Z0-9_-]/g, "_");
  return clean || `custom_${index + 1}`;
}

function httpStatusMatches(actual, expected) {
  if (expected === null || expected === undefined) {
    return true;
  }

  if (Array.isArray(expected)) {
    return expected.includes(actual);
  }

  return actual === expected;
}

function formatExpectedHttp(expected) {
  if (expected === null || expected === undefined) {
    return "any";
  }

  if (Array.isArray(expected)) {
    return expected.join("/");
  }

  return String(expected);
}

function sendHttpRequest(urlStr, method, payload = null, headers = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const safeResolve = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const safeReject = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    try {
      const parsedUrl = new URL(urlStr);
      const client = parsedUrl.protocol === "https:" ? require("https") : http;

      const bodyStr =
        payload === null || payload === undefined
          ? ""
          : typeof payload === "string"
            ? payload
            : JSON.stringify(payload);

      const reqHeaders = { ...headers };

      if (payload !== null && payload !== undefined) {
        reqHeaders["Content-Type"] = "application/json";
        reqHeaders["Content-Length"] = Buffer.byteLength(bodyStr);
      }

      const req = client.request(
        parsedUrl,
        {
          method,
          headers: reqHeaders
        },
        (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            let parsed;
            const trimmed = data ? data.trim() : "";

            try {
              parsed = JSON.parse(trimmed || "{}");
            } catch {
              parsed = trimmed;
            }

            safeResolve({
              status: res.statusCode,
              body: parsed,
              raw: trimmed
            });
          });
        }
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        safeReject(new Error(`HTTP Request Timed Out after ${timeoutMs}ms (${urlStr})`));
      });

      req.on("error", (err) => {
        safeReject(new Error(`HTTP Request Failed (${urlStr}): ${err.message}`));
      });

      if (
        payload !== null &&
        payload !== undefined &&
        method !== "GET" &&
        method !== "HEAD"
      ) {
        req.write(bodyStr);
      }

      req.end();
    } catch (err) {
      safeReject(new Error(`Invalid URL (${urlStr}): ${err.message}`));
    }
  });
}

function loadConfig() {
  const configPath = path.resolve(process.cwd(), "invariant.config.js");

  if (!fs.existsSync(configPath)) {
    console.error(
      `\n❌ ${fmt.red("CONFIG ERROR")}: Missing ${fmt.bold("invariant.config.js")} in directory ${process.cwd()}`
    );
    console.error(`Run ${fmt.bold("npx invariant init")} to generate a template config.\n`);
    process.exit(EXIT_CONFIG_ERROR);
  }

  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } catch (err) {
    console.error(
      `\n❌ ${fmt.red("CONFIG ERROR")}: Failed to load ${fmt.bold("invariant.config.js")}: ${err.message}\n`
    );
    process.exit(EXIT_CONFIG_ERROR);
  }
}

async function fetchProbeState(probeUrl, timeoutMs) {
  const res = await sendHttpRequest(probeUrl, "GET", null, {}, timeoutMs);

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`State Probe Endpoint at ${probeUrl} returned HTTP ${res.status}`);
  }

  if (
    typeof res.body !== "object" ||
    res.body === null ||
    Array.isArray(res.body) ||
    res.raw === ""
  ) {
    throw new Error(
      `State Probe Endpoint at ${probeUrl} returned non-JSON object payload (Received: '${res.raw || "0 bytes"}')`
    );
  }

  return res.body;
}

async function executeStateReset(resetUrl, timeoutMs) {
  if (!resetUrl) return;

  let res;

  try {
    res = await sendHttpRequest(resetUrl, "POST", null, {}, timeoutMs);

    if (res.status === 405 || res.status === 404) {
      res = await sendHttpRequest(resetUrl, "GET", null, {}, timeoutMs);
    }
  } catch {
    res = await sendHttpRequest(resetUrl, "GET", null, {}, timeoutMs);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`State Reset Endpoint at ${resetUrl} returned HTTP ${res.status}`);
  }
}

async function waitForAssertion({
  probeUrl,
  httpTimeoutMs,
  assertionTimeoutMs,
  assertState,
  httpRes,
  baselineState,
  expectHttpMatched
}) {
  const startedAt = Date.now();
  // If HTTP status failed expectation (e.g. got 500 when expecting 200), cap settle at 1000ms max.
  // If HTTP status matched expectation, respect the full assertionTimeoutMs budget for async background queue workers!
  const maxSettleMs = expectHttpMatched ? Math.max(assertionTimeoutMs, 500) : 1000;

  let lastState = null;
  let lastError = null;

  while (Date.now() - startedAt < maxSettleMs) {
    try {
      const probeTimeout = Math.min(httpTimeoutMs, 1500);
      lastState = await fetchProbeState(probeUrl, probeTimeout);

      let assertionResult = false;
      try {
        assertionResult = Boolean(assertState(lastState, httpRes, baselineState));
      } catch (assertErr) {
        lastError = new Error(`Assertion function error: ${assertErr.message}`);
      }

      if (assertionResult) {
        return {
          passed: true,
          state: lastState,
          error: null
        };
      }

      // ONLY settle early on unchanged state IF HTTP status failed expectations.
      // If HTTP matched expected status, NEVER break early on unchanged state — respect assertionTimeoutMs for async queue workers.
      if (!expectHttpMatched && Date.now() - startedAt >= 600) {
        break;
      }
    } catch (err) {
      lastError = err;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return {
    passed: false,
    state: lastState,
    error: lastError
  };
}

async function handleTest(subcommand) {
  fmt.banner();

  const startTime = Date.now();
  const config = loadConfig();

  const httpTimeoutMs = Number(config.httpTimeoutMs || config.timeoutMs || 5000);
  const assertionTimeoutMs = Number(config.assertionTimeoutMs || config.timeoutMs || 5000);

  // Per-Run Nonce to guarantee unique Event IDs across consecutive test runs without resetUrl
  const runNonce = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  let providerName = String(config.provider || "stripe").toLowerCase().trim();

  if (subcommand === "stripe-webhooks") {
    providerName = "stripe";
  }

  if (subcommand === "razorpay-webhooks") {
    providerName = "razorpay";
  }

  if (!SUPPORTED_PROVIDERS.includes(providerName)) {
    console.error(`\n❌ ${fmt.red("CONFIG ERROR")}: Unsupported provider '${config.provider}'.`);
    console.error(
      `Supported providers: ${SUPPORTED_PROVIDERS.map((p) => fmt.cyan(p)).join(", ")}\n`
    );
    process.exit(EXIT_CONFIG_ERROR);
  }

  if (!Array.isArray(config.invariants) || config.invariants.length === 0) {
    console.error(`\n❌ ${fmt.red("CONFIG ERROR")}: No invariants found in invariant.config.js\n`);
    process.exit(EXIT_CONFIG_ERROR);
  }

  console.log(`[Config] Target Webhook URL: ${fmt.cyan(config.targetUrl)}`);
  console.log(`[Config] State Probe URL: ${fmt.cyan(config.probeUrl)}`);

  if (config.resetUrl) {
    console.log(`[Config] State Reset URL: ${fmt.cyan(config.resetUrl)}`);
  }

  console.log(`[Config] Provider: ${fmt.yellow(providerName.toUpperCase())}`);
  console.log(`[Config] HTTP Timeout: ${fmt.dim(`${httpTimeoutMs}ms`)} | DB Assertion Timeout: ${fmt.dim(`${assertionTimeoutMs}ms`)}`);
  console.log(`[Config] Invariants Count: ${fmt.bold(config.invariants.length)}`);

  try {
    await fetchProbeState(config.probeUrl, httpTimeoutMs);
  } catch (err) {
    console.error(`\n❌ ${fmt.red("REACHABILITY / PROBE ERROR")}: ${err.message}`);
    console.error(
      `Ensure your local backend server is running and returning HTTP 200 JSON from probe URL.\n`
    );
    process.exit(EXIT_CONFIG_ERROR);
  }

  let failuresCount = 0;

  console.log(`\n>>> EXECUTING SCENARIO PIPELINE: CLI → Webhook → State Probe → State Assertions\n`);

  for (let i = 0; i < config.invariants.length; i++) {
    const inv = config.invariants[i];

    const scenario = normalizeScenario(inv.scenario);
    const name = String(inv.name || scenario || `invariant-${i + 1}`).trim();

    console.log(`------------------------------------------------------------`);
    console.log(
      `[INVARIANT ${i + 1}/${config.invariants.length}] ${fmt.bold(name)} (${fmt.yellow(scenario || "custom")})`
    );
    console.log(`Description: ${fmt.dim(inv.description || "")}`);
    console.log(`------------------------------------------------------------`);

    if (typeof inv.assertState !== "function" && typeof inv.assert !== "function") {
      console.log(`   ${fmt.yellow("⚠ No assertState/assert defined — invariant will auto-pass.")}`);
    }

    if (config.resetUrl) {
      try {
        await executeStateReset(config.resetUrl, httpTimeoutMs);
      } catch (resetErr) {
        failuresCount++;
        console.log(
          `❌ RESULT: ${fmt.badgeFail()} — ${fmt.red("State Reset Error:")} ${resetErr.message}`
        );
        continue;
      }
    }

    let baselineState;

    try {
      baselineState = await fetchProbeState(config.probeUrl, httpTimeoutMs);
    } catch (err) {
      failuresCount++;
      console.log(`❌ RESULT: ${fmt.badgeFail()} — ${fmt.red("Probe Error:")} ${err.message}`);
      continue;
    }

    const key = scenarioKey(scenario, i);
    // Unique Event ID incorporating per-run nonce
    const eventId = `evt_inv_${key}_${runNonce}`;

    const triggerFailure = scenario === "server_error_resilience";

    let payloadObj;

    if (scenario === "out_of_order") {
      payloadObj =
        providerName === "stripe"
          ? stripe.generateChargeRefunded(eventId, 5000)
          : razorpay.generateRefundProcessed(eventId, 5000);
    } else {
      payloadObj =
        providerName === "stripe"
          ? stripe.generatePaymentIntentSucceeded(eventId, 5000, triggerFailure)
          : razorpay.generatePaymentCaptured(eventId, 5000, triggerFailure);
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

    try {
      const httpRes = await sendHttpRequest(
        config.targetUrl,
        "POST",
        payloadStr,
        headers,
        httpTimeoutMs
      );

      let duplicateRes = null;

      if (scenario === "duplicate_delivery") {
        console.log(` ↳ Dispatching duplicate webhook payload (ID: ${eventId})...`);
        duplicateRes = await sendHttpRequest(
          config.targetUrl,
          "POST",
          payloadStr,
          headers,
          httpTimeoutMs
        );
      }

      const primaryHttpMatch = httpStatusMatches(httpRes.status, inv.expectHttp);

      const duplicateHttpMatch = duplicateRes
        ? httpStatusMatches(duplicateRes.status, inv.expectHttp)
        : true;

      const httpStatusMatched = primaryHttpMatch && duplicateHttpMatch;

      const assertState =
        typeof inv.assertState === "function"
          ? inv.assertState
          : typeof inv.assert === "function"
            ? (state, res, baseline) => inv.assert(state, res, baseline)
            : () => true;

      const assertion = await waitForAssertion({
        probeUrl: config.probeUrl,
        httpTimeoutMs,
        assertionTimeoutMs,
        assertState,
        httpRes,
        baselineState,
        expectHttpMatched: httpStatusMatched
      });

      const passed = httpStatusMatched && assertion.passed;

      if (passed) {
        console.log(
          `✅ RESULT: ${fmt.badgePass()} — HTTP ${httpRes.status} | DB State Verified`
        );
      } else {
        failuresCount++;

        const expectedHttpStatus = formatExpectedHttp(inv.expectHttp);

        const httpFailMsg = !httpStatusMatched
          ? ` (Expected HTTP ${expectedHttpStatus}, got Primary:${httpRes.status}${
              duplicateRes ? ` Dup:${duplicateRes.status}` : ""
            })`
          : "";

        const paymentCount =
          assertion.state && typeof assertion.state.paymentCount !== "undefined"
            ? assertion.state.paymentCount
            : "unknown";

        console.log(
          `❌ RESULT: ${fmt.badgeFail()} — HTTP ${httpRes.status}${httpFailMsg} | DB Payment Count: ${paymentCount}`
        );

        if (scenario === "server_error_resilience" && httpRes.status !== 500) {
          const keyName = providerName === "stripe" ? "metadata.invariant_test" : "notes.invariant_test";
          console.log(`   ${fmt.yellow("💡 Hint:")} Backend did not return 500. Program your dev server to throw 500 when it detects ${keyName} === 'trigger_db_failure'`);
        }

        if (assertion.error) {
          console.log(`   ${fmt.red("Probe/Assertion Error:")} ${assertion.error.message}`);
        }

        console.log(
          `   ${fmt.red("Business Risk:")} Scenario '${scenario || "custom"}' failed business post-conditions.`
        );
      }
    } catch (err) {
      failuresCount++;
      console.log(`❌ RESULT: ${fmt.badgeFail()} — ${err.message}`);
    }
  }

  const durationMs = Date.now() - startTime;

  console.log(`\n============================================================`);
  console.log(
    `SUMMARY: ${config.invariants.length - failuresCount}/${config.invariants.length} Invariants Passed (${durationMs}ms)`
  );

  if (failuresCount === 0) {
    console.log(`STATUS: ${fmt.green("🟢 BUSINESS OUTCOME HEALTHY")} — All invariants hold true.`);
    console.log(`============================================================\n`);
    process.exit(EXIT_SUCCESS);
  } else {
    console.log(
      `STATUS: ${fmt.red("🔴 BUSINESS INTEGRITY FAILURE DETECTED!")} (${failuresCount} Violations)`
    );
    console.log(`============================================================\n`);
    process.exit(EXIT_INTEGRITY_FAIL);
  }
}

module.exports = { handleTest };
