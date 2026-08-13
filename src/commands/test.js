/**
 * Command Handler: `npx invariant test stripe-webhooks` / `payment`
 * Provider-Accurate State Assertion Runner
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const fmt = require('../utils/formatter');
const razorpay = require('../providers/razorpay');
const stripe = require('../providers/stripe');

const EXIT_SUCCESS = 0;
const EXIT_INTEGRITY_FAIL = 1;
const EXIT_CONFIG_ERROR = 2;

const SUPPORTED_PROVIDERS = ['stripe', 'razorpay'];

function sendHttpRequest(urlStr, method, payload = null, headers = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const bodyStr = payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : '';
      const reqHeaders = { ...headers };
      if (payload) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
      }

      const req = http.request(urlStr, { method, headers: reqHeaders }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed;
          const trimmed = data ? data.trim() : '';
          try { 
            parsed = JSON.parse(trimmed || '{}'); 
          } catch (e) { 
            parsed = trimmed; 
          }
          resolve({ status: res.statusCode, body: parsed, raw: trimmed });
        });
      });

      // Request Timeout Guard
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error(`HTTP Request Timed Out after ${timeoutMs}ms (${urlStr})`));
      });

      req.on('error', (err) => reject(new Error(`HTTP Request Failed (${urlStr}): ${err.message}`)));
      if (payload) req.write(bodyStr);
      req.end();
    } catch (err) {
      reject(new Error(`Invalid URL (${urlStr}): ${err.message}`));
    }
  });
}

function loadConfig() {
  const configPath = path.resolve(process.cwd(), 'invariant.config.js');
  if (!fs.existsSync(configPath)) {
    console.error(`\n❌ ${fmt.red('CONFIG ERROR')}: Missing ${fmt.bold('invariant.config.js')} in directory ${process.cwd()}`);
    console.error(`   Run ${fmt.bold('npx invariant init')} to generate a template config.\n`);
    process.exit(EXIT_CONFIG_ERROR);
  }
  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } catch (err) {
    console.error(`\n❌ ${fmt.red('CONFIG ERROR')}: Failed to load ${fmt.bold('invariant.config.js')}: ${err.message}\n`);
    process.exit(EXIT_CONFIG_ERROR);
  }
}

async function fetchProbeState(probeUrl, timeoutMs) {
  const res = await sendHttpRequest(probeUrl, 'GET', null, {}, timeoutMs);
  
  // Enforce HTTP 2xx status for probe endpoint
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`State Probe Endpoint at ${probeUrl} returned HTTP ${res.status}`);
  }
  
  if (typeof res.body !== 'object' || res.body === null || res.raw === '') {
    throw new Error(`State Probe Endpoint at ${probeUrl} returned non-JSON payload (Received: '${res.raw || '0 bytes'}')`);
  }
  return res.body;
}

async function executeStateReset(resetUrl, timeoutMs) {
  if (!resetUrl) return;
  
  let res;
  try {
    res = await sendHttpRequest(resetUrl, 'POST', null, {}, timeoutMs);
    // If POST returns 405 Method Not Allowed, fallback to GET
    if (res.status === 405) {
      res = await sendHttpRequest(resetUrl, 'GET', null, {}, timeoutMs);
    }
  } catch (e) {
    res = await sendHttpRequest(resetUrl, 'GET', null, {}, timeoutMs);
  }

  // Enforce HTTP 2xx status for resetUrl endpoint
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`State Reset Endpoint at ${resetUrl} returned HTTP ${res.status}`);
  }
}

async function handleTest(subcommand) {
  fmt.banner();
  const startTime = Date.now();

  const config = loadConfig();
  const timeoutMs = config.timeoutMs || 5000;
  
  // Explicit Provider Validation
  let providerName = config.provider ? config.provider.toLowerCase() : 'stripe';
  if (subcommand === 'stripe-webhooks') providerName = 'stripe';

  if (!SUPPORTED_PROVIDERS.includes(providerName)) {
    console.error(`\n❌ ${fmt.red('CONFIG ERROR')}: Unsupported provider '${config.provider}'.`);
    console.error(`   Supported providers: ${SUPPORTED_PROVIDERS.map(p => fmt.cyan(p)).join(', ')}\n`);
    process.exit(EXIT_CONFIG_ERROR);
  }

  console.log(`[Config] Target Webhook URL: ${fmt.cyan(config.targetUrl)}`);
  console.log(`[Config] State Probe URL:   ${fmt.cyan(config.probeUrl)}`);
  if (config.resetUrl) console.log(`[Config] State Reset URL:   ${fmt.cyan(config.resetUrl)}`);
  console.log(`[Config] Provider:          ${fmt.yellow(providerName.toUpperCase())}`);
  console.log(`[Config] Request Timeout:   ${fmt.dim(timeoutMs + 'ms')}`);
  console.log(`[Config] Invariants Count:  ${fmt.bold(config.invariants.length)}`);

  // Test target reachability & probe validity
  try {
    await fetchProbeState(config.probeUrl, timeoutMs);
  } catch (err) {
    console.error(`\n❌ ${fmt.red('REACHABILITY / PROBE ERROR')}: ${err.message}`);
    console.error(`   Ensure your local backend server is running and returning HTTP 200 JSON from probe URL.\n`);
    process.exit(EXIT_CONFIG_ERROR);
  }

  let failuresCount = 0;
  console.log(`\n>>> EXECUTING SCENARIO PIPELINE: CLI → Webhook → State Probe → State Assertions\n`);

  for (let i = 0; i < config.invariants.length; i++) {
    const inv = config.invariants[i];
    console.log(`------------------------------------------------------------`);
    console.log(`[INVARIANT ${i+1}/${config.invariants.length}] ${fmt.bold(inv.name || 'invariant')}  (${fmt.yellow(inv.scenario || 'custom')})`);
    console.log(` Description: ${fmt.dim(inv.description)}`);
    console.log(`------------------------------------------------------------`);

    // Reset state before scenario if resetUrl is provided (Enforce failure if reset fails with non-2xx)
    if (config.resetUrl) {
      try {
        await executeStateReset(config.resetUrl, timeoutMs);
      } catch (resetErr) {
        failuresCount++;
        console.log(`❌ RESULT: ${fmt.badgeFail()} — ${fmt.red('State Reset Error:')} ${resetErr.message}`);
        continue;
      }
    }

    // Capture baseline state BEFORE scenario dispatch
    let baselineState;
    try {
      baselineState = await fetchProbeState(config.probeUrl, timeoutMs);
    } catch (err) {
      failuresCount++;
      console.log(`❌ RESULT: ${fmt.badgeFail()} — ${fmt.red('Probe Error:')} ${err.message}`);
      continue;
    }

    const eventId = `evt_inv_${inv.scenario || i}`;
    const triggerFailure = (inv.scenario === 'server_error_resilience');

    // Generate Payload based on scenario & provider
    let payloadObj;
    if (inv.scenario === 'out_of_order') {
      payloadObj = providerName === 'stripe'
        ? stripe.generateChargeRefunded(eventId, 5000)
        : razorpay.generateRefundProcessed(eventId, 5000);
    } else {
      payloadObj = providerName === 'stripe'
        ? stripe.generatePaymentIntentSucceeded(eventId, 5000, triggerFailure)
        : razorpay.generatePaymentCaptured(eventId, 5000, triggerFailure);
    }

    const payloadStr = JSON.stringify(payloadObj);

    // Generate Official Provider Signature Header
    const headers = {};
    if (inv.scenario === 'tampered_signature') {
      headers[providerName === 'stripe' ? 'Stripe-Signature' : 'x-razorpay-signature'] = 't=123456,v1=tampered_signature_hash';
    } else if (providerName === 'stripe') {
      const sig = stripe.generateStripeSignature(payloadStr, config.webhookSecret);
      headers['Stripe-Signature'] = sig.header;
    } else {
      const sig = razorpay.generateRazorpaySignature(payloadStr, config.webhookSecret);
      headers['x-razorpay-signature'] = sig;
    }

    try {
      // 1. Dispatch Primary Webhook HTTP Request
      const httpRes = await sendHttpRequest(config.targetUrl, 'POST', payloadStr, headers, timeoutMs);
      let duplicateRes = null;

      // 2. If Duplicate Scenario, dispatch duplicate request immediately
      if (inv.scenario === 'duplicate_delivery') {
        console.log(` ↳ Dispatching duplicate webhook payload (ID: ${eventId})...`);
        duplicateRes = await sendHttpRequest(config.targetUrl, 'POST', payloadStr, headers, timeoutMs);
      }

      // 3. Query State Probe Endpoint for Post-State
      const currentState = await fetchProbeState(config.probeUrl, timeoutMs);

      // 4. Central HTTP Status Enforcement across both primary & duplicate requests
      const primaryHttpMatch = inv.expectHttp ? (httpRes.status === inv.expectHttp) : true;
      const duplicateHttpMatch = (duplicateRes && inv.expectHttp) ? (duplicateRes.status === inv.expectHttp) : true;
      const httpStatusMatched = primaryHttpMatch && duplicateHttpMatch;

      // 5. Evaluate Invariant AssertState Function
      const statePassed = Boolean(inv.assertState ? inv.assertState(currentState, httpRes, baselineState) : inv.assert(currentState, httpRes));

      const passed = httpStatusMatched && statePassed;

      if (passed) {
        console.log(`✅ RESULT: ${fmt.badgePass()} — HTTP ${httpRes.status} | DB State Verified`);
      } else {
        failuresCount++;
        const httpFailMsg = !httpStatusMatched 
          ? ` (Expected HTTP ${inv.expectHttp}, got Primary:${httpRes.status}${duplicateRes ? ' Dup:'+duplicateRes.status : ''})` 
          : '';
        console.log(`❌ RESULT: ${fmt.badgeFail()} — HTTP ${httpRes.status}${httpFailMsg} | DB Payment Count: ${currentState.paymentCount}`);
        console.log(`   ${fmt.red('Business Risk:')} Scenario '${inv.scenario}' failed business post-conditions.`);
      }
    } catch (err) {
      failuresCount++;
      console.log(`❌ RESULT: ${fmt.badgeFail()} — ${err.message}`);
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`\n============================================================`);
  console.log(` SUMMARY: ${config.invariants.length - failuresCount}/${config.invariants.length} Invariants Passed  (${durationMs}ms)`);
  
  if (failuresCount === 0) {
    console.log(` STATUS: ${fmt.green('🟢 BUSINESS OUTCOME HEALTHY')} — All invariants hold true.`);
    console.log(`============================================================\n`);
    process.exit(EXIT_SUCCESS);
  } else {
    console.log(` STATUS: ${fmt.red('🔴 BUSINESS INTEGRITY FAILURE DETECTED!')} (${failuresCount} Violations)`);
    console.log(`============================================================\n`);
    process.exit(EXIT_INTEGRITY_FAIL);
  }
}

module.exports = { handleTest };
