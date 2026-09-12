const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (file.endsWith(".js")) {
      const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
      if (result.error || result.status !== 0) process.exit(1);
    }
  }
}
for (const directory of ["src", "test", "examples/sqlite-queue"]) check(path.resolve(__dirname, "..", directory));
console.log("All JavaScript syntax checks passed.");
