/**
 * Output Formatter & ANSI Terminal Color Utilities
 * Supports --ci / CI / INVARIANT_CI color stripping for clean CI logs
 */

const pkg = require("../../package.json");

const isCI =
  Boolean(process.env.CI) ||
  Boolean(process.env.INVARIANT_CI) ||
  process.argv.includes("--ci");

const supportsColor = !isCI && process.stdout.isTTY !== false;

function code(open, close, str) {
  if (!supportsColor) return str;
  return `${open}${str}${close}`;
}

const fmt = {
  isCI,
  bold: (str) => code("\x1b[1m", "\x1b[22m", str),
  dim: (str) => code("\x1b[2m", "\x1b[22m", str),
  red: (str) => code("\x1b[31m", "\x1b[39m", str),
  green: (str) => code("\x1b[32m", "\x1b[39m", str),
  yellow: (str) => code("\x1b[33m", "\x1b[39m", str),
  cyan: (str) => code("\x1b[36m", "\x1b[39m", str),

  badgePass: () => (supportsColor ? "\x1b[42m\x1b[30m\x1b[1m ✔ PASSED \x1b[0m" : "[PASSED]"),
  badgeFail: () => (supportsColor ? "\x1b[41m\x1b[37m\x1b[1m ✖ FAILED \x1b[0m" : "[FAILED]"),

  banner: () => {
    if (isCI) {
      console.log(`Invariant CLI v${pkg.version} — Business Layer (https://yavonalabs.com)`);
      return;
    }
    console.log(
      fmt.bold(`
============================================================
Invariant CLI v${pkg.version} — Business Layer
Website: https://yavonalabs.com
============================================================`)
    );
  }
};

module.exports = fmt;
