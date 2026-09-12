const { loadConfig, validateConfig, checkProbeFields } = require("../utils/config");
const { fetchProbeState } = require("../utils/http");
const { newReport, writeReports, createRedactor, safeUrl } = require("../utils/reports");
const { printSetupHelp } = require("../utils/support");

async function handleDoctor(suite = "payment", options = {}) {
  const report = newReport("doctor");
  const started = Date.now();
  let config;
  let exitCode = 0;
  const add = (name, status, message) => report.cases.push({ name, status, message });
  console.log("Invariant setup diagnostic — reads the state probe only.");
  try {
    config = validateConfig(loadConfig(options.config), suite);
    const redact = createRedactor(config);
    report.configuration = { provider: config.provider, targetUrl: safeUrl(config.targetUrl), probeUrl: safeUrl(config.probeUrl),
      assertionTimeoutMs: config.assertionTimeoutMs, stabilityWindowMs: config.stabilityWindowMs };
    add("Configuration", "passed", `${config.invariants.length} assertions and HTTP expectations configured.`);
    add("Signing configuration", "warning", "A local signing secret is configured. Matching the backend secret and verifying signature rejection require an executed test.");
    add("Webhook and reset endpoints", "not_run", "No webhook or reset request was sent. Reachability and behavior of these routes were not tested.");
    if (config.webhookSecret.startsWith("whsec_yavona_") || config.webhookSecret === "whsec_stripe_secret_12345") {
      add("Example secret", "warning", "An example signing secret is in use. Match it to your isolated test backend or configure your own test secret.");
    }
    let state;
    try {
      state = await fetchProbeState(config.probeUrl, config.httpTimeoutMs, config.probeHeaders);
      add("State probe", "passed", "Probe returned HTTP 200 and a JSON object. State values are not printed by doctor.");
    } catch (error) {
      add("State probe", "inconclusive", redact(error.message));
      exitCode = 2;
    }
    if (state) {
      for (const [i, inv] of config.invariants.entries()) {
        const name = inv.name || inv.scenario || `Invariant ${i + 1}`;
        const fields = { ...config.requiredProbeFields, ...inv.requiredProbeFields };
        if (!Object.keys(fields).length) {
          add(`${name}: probe fields`, "warning", "No requiredProbeFields declared. Doctor cannot infer the fields used by an arbitrary assertion function.");
        } else {
          const errors = checkProbeFields(state, fields);
          add(`${name}: probe fields`, errors.length ? "inconclusive" : "passed", errors.length ? errors.join("; ") : "Declared probe fields are present with the expected types.");
          if (errors.length) exitCode = 2;
        }
        const custom = inv.payload !== undefined || typeof inv.generatePayload === "function";
        add(`${name}: fixture mapping`, "warning", custom
          ? "Custom payload configured. Its customer/payment IDs must match your test data; callbacks were not executed or mappings verified."
          : "Built-in synthetic IDs are used. Seed matching records or provide payload/generatePayload if the handler looks up existing customers, orders or subscriptions.");
      }
    }
    report.status = exitCode ? "inconclusive" : "warning";
  } catch (error) {
    report.error = createRedactor(config)(error.message);
    exitCode = 2;
  }
  report.durationMs = Date.now() - started;
  report.finishedAt = new Date().toISOString();
  const redact = createRedactor(config);
  for (const item of report.cases) console.log(`[${item.status.toUpperCase()}] ${redact(item.name)}: ${redact(item.message)}`);
  if (report.error) console.error(`CONFIG ERROR: ${report.error}`);
  console.log(exitCode ? "Setup needs attention. No payment outcome was verified." : "Setup checks completed with the limits above. Run test to verify payment behavior.");
  try {
    const output = writeReports(report, options.reportDir, config);
    if (output) console.log(`Reports: ${output}`);
  } catch (error) {
    console.error(`REPORT ERROR: ${redact(error.message)}`);
    exitCode = 2;
  }
  if (exitCode !== 0) printSetupHelp();
  process.exitCode = exitCode;
  return report;
}

module.exports = { handleDoctor };
