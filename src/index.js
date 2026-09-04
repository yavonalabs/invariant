#!/usr/bin/env node

/**
 * Invariant CLI Command Router
 * npx @yavona/invariant
 *
 * Website: https://yavonalabs.com
 */

const fmt = require("./utils/formatter");
const { handleInit } = require("./commands/init");
const { handleTest } = require("./commands/test");
const { handleDemo } = require("./commands/demo");

const args = process.argv.slice(2);

const command = args[0] ? args[0].toLowerCase() : "help";
const subcommand = args[1] ? args[1].toLowerCase() : "payment";

function printHelp() {
  fmt.banner();

  console.log(`
${fmt.bold("USAGE:")}
$ npx @yavona/invariant <command> [subcommand] [options]

${fmt.bold("COMMANDS:")}
${fmt.cyan("demo")}                    Run the zero-dependency theatrical business invariant demo
${fmt.cyan("init")}                    Generate template invariant.config.js in project
${fmt.cyan("test stripe-webhooks")}    Execute provider-accurate Stripe webhook state assertions
${fmt.cyan("test razorpay-webhooks")}  Execute provider-accurate Razorpay webhook state assertions
${fmt.cyan("test payment")}            Execute payment webhook state assertions using config provider
${fmt.cyan("version / --version")}       Print Invariant CLI version
${fmt.cyan("help    / --help")}          Print CLI usage & help options

${fmt.bold("EXAMPLES:")}
$ npx @yavona/invariant demo
$ npx @yavona/invariant init
$ npx @yavona/invariant test stripe-webhooks
$ INVARIANT_WEBHOOK_SECRET=whsec_xyz npx @yavona/invariant test stripe-webhooks

${fmt.bold("WEBSITE:")}
https://yavonalabs.com
`);
}

async function main() {
  switch (command) {
    case "demo":
      await handleDemo();
      break;

    case "init":
      await handleInit();
      break;

    case "test":
      await handleTest(subcommand);
      break;

    case "version":
    case "-v":
    case "--version":
      const pkg = require("../package.json");
      console.log(`Invariant CLI v${pkg.version}`);
      break;

    case "help":
    case "-h":
    case "--help":
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error(`\n❌ UNHANDLED INVARIANT EXCEPTION: ${err.message}`);
  process.exit(1);
});
