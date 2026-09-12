const { performance } = require("perf_hooks");

const POLL_INTERVAL_MS = 200;

async function withTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Probe/assertion observation deadline exceeded")), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A pass describes sampled state within a finite observation window. It does
// not certify queue completion or rule out mutations after this window.
async function observeAssertion({ readState, assertState, httpRes, baselineState,
  assertionTimeoutMs, stabilityWindowMs, onSample = () => {} }, timing = {
  now: () => performance.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  const { now, sleep } = timing;
  const startedAt = now();
  const deadline = startedAt + assertionTimeoutMs;
  let state = null;
  let firstMatchAt = null;
  let lastMatchAt = null;
  let samples = 0;
  const result = (passed, error = null, status = passed ? "passed" : "inconclusive") => ({
    passed, status, state, error, samples, observedMs: Math.round(now() - startedAt)
  });

  while (now() < deadline) {
    const availableMs = deadline - now();
    if (samples > 0 && availableMs < POLL_INTERVAL_MS) {
      await sleep(Math.ceil(availableMs));
      break;
    }
    try {
      const remainingMs = Math.max(1, deadline - now());
      const matches = await withTimeout(async () => {
        state = await readState(remainingMs);
        const value = await assertState(state, httpRes, baselineState);
        if (typeof value !== "boolean") {
          throw new Error("Assertion must return a boolean (or Promise<boolean>)");
        }
        return value;
      }, remainingMs);
      if (now() >= deadline) {
        return result(false, new Error("Probe/assertion observation deadline exceeded"));
      }
      samples++;
      onSample({ elapsedMs: Math.round(now() - startedAt), matched: matches, state });
      if (matches) {
        firstMatchAt ??= now();
        lastMatchAt = now();
      } else if (firstMatchAt !== null) {
        return result(false, new Error("State assertion regressed after an earlier matching sample"), "failed");
      }
    } catch (error) {
      // Missing evidence or broken assertions must never become a green result.
      return result(false, error);
    }
    const remainingMs = deadline - now();
    // Do not start an extra request with a sub-millisecond budget when a
    // timer wakes just before the deadline. Preserve the polling cadence.
    if (remainingMs <= POLL_INTERVAL_MS) {
      if (remainingMs > 0) {
        await sleep(Math.ceil(remainingMs));
      }
      break;
    }
    if (remainingMs > 0) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  if (firstMatchAt === null) {
    return result(false, new Error("State assertion did not match within the observation window"), "failed");
  }
  if (lastMatchAt - firstMatchAt < stabilityWindowMs) {
    return result(false, new Error("Insufficient matching observations for stabilityWindowMs; increase assertionTimeoutMs"));
  }
  return result(true);
}

module.exports = { observeAssertion };
