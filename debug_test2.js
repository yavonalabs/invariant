const { spawn } = require("child_process");
const path = require("path");

const CLI_PATH = path.resolve(__dirname, "src/index.js");

const child = spawn("node", [CLI_PATH, "test", "stripe-webhooks"], {
  cwd: __dirname,
  env: {
    ...process.env,
    INVARIANT_TARGET_URL: "http://localhost:54013/api/webhook",
    INVARIANT_PROBE_URL: "http://localhost:54013/api/db-state",
    INVARIANT_RESET_URL: "",
    INVARIANT_PROVIDER: "stripe",
    INVARIANT_WEBHOOK_SECRET: "whsec_yavona_secret_12345"
  }
});

let stdout = "";
let stderr = "";
child.stdout.on("data", c => stdout += c);
child.stderr.on("data", c => stderr += c);

child.on("close", (code) => {
  console.log("Exit code:", code);
  console.log("Stdout:\n", stdout);
  console.log("Stderr:\n", stderr);
});
