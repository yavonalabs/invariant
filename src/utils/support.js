const SETUP_HELP_URL = "https://github.com/yavonalabs/invariant/issues/new?template=setup-help.md";

function printSetupHelp() {
  console.error(`Need help connecting your first payment flow? Optional setup help: ${SETUP_HELP_URL}`);
  console.error("GitHub issues are public. Share your CLI version, framework, provider, and a sanitized error summary only; omit code, credentials, payment data, and full reports.");
}

module.exports = { SETUP_HELP_URL, printSetupHelp };
