const http = require("http");

function sendHttpRequest(urlStr, method, payload = null, headers = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadlineTimer;

    const safeResolve = (value) => {
      if (!settled) {
        settled = true;
        clearTimeout(deadlineTimer);
        resolve(value);
      }
    };

    const safeReject = (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(deadlineTimer);
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
          headers: reqHeaders,
          timeout: timeoutMs
        },
        (res) => {
          let responseBody = "";
          let responseBytes = 0;
          res.on("error", safeReject);
          res.on("aborted", () => safeReject(new Error("HTTP response ended before completion")));

          res.on("data", (chunk) => {
            responseBytes += chunk.length;
            if (responseBytes > 2 * 1024 * 1024) {
              res.destroy(new Error("HTTP response exceeded the 2 MiB evidence limit"));
              return;
            }
            responseBody += chunk;
          });

          res.on("end", () => {
            safeResolve({
              status: res.statusCode,
              headers: res.headers,
              body: responseBody
            });
          });
        }
      );

      deadlineTimer = setTimeout(() => {
        req.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      req.on("timeout", () => {
        req.destroy();
        safeReject(new Error(`HTTP request timed out after ${timeoutMs}ms`));
      });

      req.on("error", (err) => {
        safeReject(new Error(`HTTP request failed: ${err.message}`));
      });

      if (bodyStr) {
        req.write(bodyStr);
      }

      req.end();
    } catch (err) {
      safeReject(err);
    }
  });
}


async function fetchProbeState(probeUrl, timeoutMs, headers = {}) {
  const res = await sendHttpRequest(probeUrl, "GET", null, headers, timeoutMs);

  if (res.status !== 200) {
    throw new Error(`Probe Endpoint returned HTTP ${res.status} (Expected 200)`);
  }

  try {
    const state = JSON.parse(res.body);
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("Expected a JSON object containing probe fields");
    }
    return state;
  } catch (err) {
    throw new Error(`Probe Endpoint returned invalid state: ${err.message}`);
  }
}

async function executeStateReset(resetUrl, timeoutMs) {
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


module.exports = { sendHttpRequest, fetchProbeState, executeStateReset };
