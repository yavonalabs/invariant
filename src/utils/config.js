const fs = require("fs");
const path = require("path");

const SCENARIOS = ["duplicate_delivery", "tampered_signature", "out_of_order",
  "server_error_resilience", "concurrent_race_condition", "partial_refund_bounds",
  "subscription_downgrade", "schema_replay_tolerance"];
const FIELD_TYPES = ["integer", "number", "string", "boolean", "array", "object"];

function loadConfig(filename = "invariant.config.js") {
  const resolved = path.resolve(filename);
  if (!fs.existsSync(resolved)) throw new Error(`Configuration not found: ${resolved}. Run invariant init first.`);
  delete require.cache[require.resolve(resolved)];
  return require(resolved);
}

function validateFields(fields, label) {
  if (fields === undefined) return;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error(`${label} must map field paths to types`);
  for (const [name, type] of Object.entries(fields)) {
    if (!name || !FIELD_TYPES.includes(type)) throw new Error(`${label}.${name}: expected one of ${FIELD_TYPES.join(", ")}`);
  }
}

function validateConfig(config, suite = "payment") {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Configuration must export an object");
  if (!["payment", "stripe-webhooks", "razorpay-webhooks"].includes(suite)) throw new Error(`Unknown test suite '${suite}'`);
  const provider = suite === "payment" ? String(config.provider || "stripe").toLowerCase().trim() : suite.split("-")[0];
  if (!["stripe", "razorpay"].includes(provider)) throw new Error("Unsupported provider; use stripe or razorpay");
  const httpTimeoutMs = Number(config.httpTimeoutMs ?? config.timeoutMs ?? 5000);
  const assertionTimeoutMs = Number(config.assertionTimeoutMs ?? config.timeoutMs ?? 5000);
  const stabilityWindowMs = Number(config.stabilityWindowMs ?? 400);
  if (![httpTimeoutMs, assertionTimeoutMs, stabilityWindowMs].every(n => Number.isFinite(n) && n >= 1 && n <= 2147483647) ||
      assertionTimeoutMs <= stabilityWindowMs + 200) {
    throw new Error("Timeouts must be positive finite milliseconds; assertionTimeoutMs must exceed stabilityWindowMs + 200ms");
  }
  for (const key of ["targetUrl", "probeUrl", ...(config.resetUrl ? ["resetUrl"] : [])]) {
    try {
      if (!["http:", "https:"].includes(new URL(config[key]).protocol)) throw new Error();
    } catch { throw new Error(`${key} must be an absolute HTTP(S) URL`); }
  }
  if (typeof config.webhookSecret !== "string" || !config.webhookSecret.trim()) throw new Error("webhookSecret must be a non-empty string");
  if (config.probeHeaders !== undefined && (!config.probeHeaders || typeof config.probeHeaders !== "object" ||
      Array.isArray(config.probeHeaders) || !Object.values(config.probeHeaders).every(v => typeof v === "string"))) {
    throw new Error("probeHeaders must map header names to string values");
  }
  if (!Array.isArray(config.invariants) || !config.invariants.length) throw new Error("No invariants found in invariant.config.js");
  validateFields(config.requiredProbeFields, "requiredProbeFields");
  for (const [i, inv] of config.invariants.entries()) {
    if (!inv || typeof inv !== "object" || (typeof inv.assertState !== "function" && typeof inv.assert !== "function")) {
      throw new Error(`Invariant ${i + 1} requires an assertState/assert function`);
    }
    const statuses = Array.isArray(inv.expectHttp) ? inv.expectHttp : [inv.expectHttp];
    if (!statuses.length || !statuses.every(v => Number.isInteger(v) && v >= 100 && v <= 599)) {
      throw new Error(`Invariant ${i + 1} requires explicit expectHttp status code(s)`);
    }
    if (!SCENARIOS.includes(String(inv.scenario || "").trim()) && inv.payload === undefined && typeof inv.generatePayload !== "function") {
      throw new Error(`Invariant ${i + 1} has an unknown scenario without a custom payload`);
    }
    validateFields(inv.requiredProbeFields, `invariants[${i}].requiredProbeFields`);
  }
  if (config.reportRedactKeys !== undefined && (!Array.isArray(config.reportRedactKeys) || !config.reportRedactKeys.every(v => typeof v === "string" && v))) {
    throw new Error("reportRedactKeys must be an array of field names");
  }
  return { ...config, provider, httpTimeoutMs, assertionTimeoutMs, stabilityWindowMs };
}

function checkProbeFields(state, fields = {}) {
  const errors = [];
  for (const [field, type] of Object.entries(fields)) {
    let value = state;
    for (const key of field.split(".")) value = value && Object.hasOwn(value, key) ? value[key] : undefined;
    const valid = type === "integer" ? Number.isSafeInteger(value) : type === "number" ? Number.isFinite(value) :
      type === "array" ? Array.isArray(value) : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) :
        typeof value === type;
    if (!valid) errors.push(`${field}: expected ${type}${value === undefined ? " (missing)" : ""}`);
  }
  return errors;
}

module.exports = { SCENARIOS, loadConfig, validateConfig, checkProbeFields };
