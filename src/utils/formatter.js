/**
 * Invariant CLI Terminal Formatter
 * Zero-dependency ANSI formatting utilities
 */

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m"
};

module.exports = {
  bold: (txt) => `${colors.bold}${txt}${colors.reset}`,
  green: (txt) => `${colors.green}${txt}${colors.reset}`,
  red: (txt) => `${colors.red}${txt}${colors.reset}`,
  cyan: (txt) => `${colors.cyan}${txt}${colors.reset}`,
  yellow: (txt) => `${colors.yellow}${txt}${colors.reset}`,
  dim: (txt) => `${colors.dim}${txt}${colors.reset}`,

  badgePass: () => `${colors.bold}${colors.green}✔ PASSED${colors.reset}`,
  badgeFail: () => `${colors.bold}${colors.red}✖ FAILED${colors.reset}`,

  banner: () => {
    console.log(`\n${colors.bold}${colors.cyan}============================================================${colors.reset}`);
    console.log(`${colors.bold}Invariant CLI v0.1.0-alpha.1${colors.reset} — Business Layer`);
    console.log(`Website: ${colors.dim}https://invariant.dev${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}============================================================${colors.reset}`);
  }
};
