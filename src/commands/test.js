const { randomUUID } = require("crypto");
const fmt = require("../utils/formatter");
const { observeAssertion } = require("../utils/assertions");
const { loadConfig, validateConfig, checkProbeFields } = require("../utils/config");
const { sendHttpRequest, fetchProbeState, executeStateReset } = require("../utils/http");
const { prepareEvent } = require("../utils/scenarios");
const { newReport, writeReports, createRedactor, safeUrl } = require("../utils/reports");
const { printSetupHelp } = require("../utils/support");

function httpMatches(actual, expected) {
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
}

async function handleTest(suite = "payment", options = {}) {
  fmt.banner();
  const started = Date.now();
  const report = newReport();
  report.runId = randomUUID();
  let config;
  let redact = createRedactor();
  let exitCode = 0;
  try {
    config = loadConfig(options.config);
    config = validateConfig(config, suite);
    redact = createRedactor(config);
    report.configuration = { provider: config.provider, targetUrl: safeUrl(config.targetUrl), probeUrl: safeUrl(config.probeUrl),
      httpTimeoutMs: config.httpTimeoutMs, assertionTimeoutMs: config.assertionTimeoutMs, stabilityWindowMs: config.stabilityWindowMs };
    report.cases = config.invariants.map((inv, i) => ({ name: inv.name || inv.scenario || `Invariant ${i + 1}`,
      scenario: String(inv.scenario || "custom").trim(), description: inv.description || "", status: "not_run",
      expectedHttp: inv.expectHttp, deliveries: [], observations: [] }));
    console.log(`[Config] Provider: ${config.provider.toUpperCase()} | Observation: ${config.assertionTimeoutMs}ms | Stability: ${config.stabilityWindowMs}ms`);
    console.log(`[Config] Target Webhook URL: ${safeUrl(config.targetUrl)}`);
    console.log(`[Config] State Probe URL: ${safeUrl(config.probeUrl)}`);
    let initialState;
    try {
      initialState = await fetchProbeState(config.probeUrl, config.httpTimeoutMs, config.probeHeaders);
      for (const inv of config.invariants) {
        const errors = checkProbeFields(initialState, { ...config.requiredProbeFields, ...inv.requiredProbeFields });
        if (errors.length) throw new Error(errors.join("; "));
      }
    } catch (error) {
      throw new Error(`REACHABILITY / PROBE ERROR: ${error.message}`);
    }
    console.log("\n>>> EXECUTING SCENARIO PIPELINE: CLI → Webhook → State Probe → State Assertions");
    for (const [i, inv] of config.invariants.entries()) {
      const item = report.cases[i];
      const caseStarted = Date.now();
      const eventId = `evt_inv_${item.scenario.replace(/[^a-zA-Z0-9_-]/g, "_")}_${i}_${report.runId}`;
      item.eventId = eventId;
      item.observationWindowMs = config.assertionTimeoutMs;
      item.stabilityWindowMs = config.stabilityWindowMs;
      console.log(`\n[INVARIANT ${i + 1}/${report.cases.length}] ${redact(item.name)} (${redact(item.scenario)}): ${redact(item.description)}`);
      try {
        if (config.resetUrl) await executeStateReset(config.resetUrl, config.httpTimeoutMs);
        const baseline = await fetchProbeState(config.probeUrl, config.httpTimeoutMs, config.probeHeaders);
        const fields = { ...config.requiredProbeFields, ...inv.requiredProbeFields };
        const errors = checkProbeFields(baseline, fields);
        if (errors.length) throw new Error(errors.join("; "));
        item.baselineState = redact(baseline);
        const event = prepareEvent(config, inv, eventId, baseline);
        item.payload = redact(event.payload);
        const dispatch = async order => {
          const delivery = { dispatchOrder: order, startedAt: new Date().toISOString(), headers: redact(event.headers) };
          item.deliveries.push(delivery);
          const sentAt = Date.now();
          try {
            const res = await sendHttpRequest(config.targetUrl, "POST", event.payloadStr, event.headers, config.httpTimeoutMs);
            delivery.response = redact(res);
            return res;
          } catch (error) {
            delivery.error = redact(error.message);
            throw error;
          } finally { delivery.durationMs = Date.now() - sentAt; }
        };
        let responses;
        if (item.scenario === "concurrent_race_condition") {
          // Wait for both deliveries, including failures, before moving to another scenario.
          const results = await Promise.allSettled([dispatch(1), dispatch(2)]);
          const failed = results.find(result => result.status === "rejected");
          if (failed) throw failed.reason;
          responses = results.map(result => result.value);
        } else {
          responses = [await dispatch(1)];
          if (item.scenario === "duplicate_delivery") responses.push(await dispatch(2));
        }
        item.httpMatched = responses.every(res => httpMatches(res.status, inv.expectHttp));
        if (!item.httpMatched) {
          item.status = "failed";
          item.error = `Expected HTTP ${[].concat(inv.expectHttp).join("/")}, got Primary:${responses[0].status}${responses[1] ? ` Dup:${responses[1].status}` : ""}; state verification not completed`;
        } else {
          const assertion = await observeAssertion({
            readState: async remaining => {
              const state = await fetchProbeState(config.probeUrl, Math.max(1, Math.min(config.httpTimeoutMs, remaining)), config.probeHeaders);
              const issues = checkProbeFields(state, fields);
              if (issues.length) throw new Error(issues.join("; "));
              return state;
            },
            assertState: inv.assertState || inv.assert, httpRes: responses[0], baselineState: baseline,
            assertionTimeoutMs: config.assertionTimeoutMs, stabilityWindowMs: config.stabilityWindowMs,
            onSample: options.reportDir ? sample => {
              if (item.observations.length < 200) item.observations.push(redact(sample));
              else item.observationsTruncated = true;
            } : undefined
          });
          item.status = assertion.status;
          item.lastState = redact(assertion.state);
          item.samples = assertion.samples;
          item.observedMs = assertion.observedMs;
          if (assertion.error) item.error = redact(assertion.error.message);
        }
      } catch (error) {
        item.status = "inconclusive";
        item.error = redact(error.message);
      }
      item.durationMs = Date.now() - caseStarted;
      if (item.status === "passed") {
        console.log(`✅ RESULT: ${fmt.badgePass()} — Assertion matched across ${item.samples} samples over ${item.observedMs}ms`);
      } else {
        exitCode = 1;
        console.log(`RESULT: ${item.status.toUpperCase()} — ${item.error}`);
        console.log(`   Baseline state: ${JSON.stringify(item.baselineState ?? null)}`);
        console.log(`   Last observed state: ${JSON.stringify(item.lastState ?? null)}`);
        if (item.scenario === "server_error_resilience") console.log("Hint: the backend must implement the failure hook; a pre-processing 500 does not verify transaction rollback.");
      }
    }
    report.status = report.cases.some(c => c.status === "failed") ? "failed" : exitCode ? "inconclusive" : "passed";
  } catch (error) {
    redact = createRedactor(config);
    report.error = redact(error.message);
    report.status = "inconclusive";
    exitCode = 2;
    console.error(`CONFIG ERROR: ${report.error}`);
  }
  report.durationMs = Date.now() - started;
  report.finishedAt = new Date().toISOString();
  try {
    const output = writeReports(report, options.reportDir, config);
    if (output) console.log(`Reports: ${output}`);
  } catch (error) {
    exitCode = 2;
    console.error(`REPORT ERROR: ${redact(error.message)}`);
  }
  const passed = report.cases.filter(item => item.status === "passed").length;
  console.log(`\nSUMMARY: ${passed}/${report.cases.length} Invariants Passed (${report.durationMs}ms)`);
  console.log(exitCode === 0 ? "STATUS: CONFIGURED CHECKS PASSED — Sampled assertions passed within their observation windows." : "STATUS: CHECKS FAILED — Review failed and inconclusive evidence.");
  if (exitCode === 2 || report.cases.some(item => item.status === "inconclusive" || item.httpMatched === false)) {
    printSetupHelp();
  }
  process.exitCode = exitCode;
  return report;
}

module.exports = { handleTest };
