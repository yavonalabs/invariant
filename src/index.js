#!/usr/bin/env node

/**
 * Invariant CLI Command Router
 * npx invariant
 *
 * Website: https://invariant.dev
 */

const fmt = require("./utils/formatter");
const { handleInit } = require("./commands/init");
const { handleTest } = require("./commands/test");

const args = process.argv.slice(2);

const command = args[0] ? args[0].toLowerCase() : "help";
const subcommand = args[1] ? args[1].toLowerCase() : "payment";

function printHelp() {
  fmt.banner();

  console.log(`
${fmt.bold("USAGE:")}
$ npx invariant <command> [subcommand] [options]

${fmt.bold("COMMANDS:")}
${fmt.cyan("init")}                    Generate template invariant.config.js in project
${fmt.cyan("test stripe-webhooks")}    Execute provider-accurate Stripe webhook state assertions
${fmt.cyan("test razorpay-webhooks")}  Execute provider-accurate Razorpay webhook state assertions
${fmt.cyan("test payment")}            Execute payment webhook state assertions using config provider
${fmt.cyan("version")} / ${fmt.cyan("--version")}       Print Invariant CLI version
${fmt.cyan("help")}    / ${fmt.cyan("--help")}          Print CLI usage & help options

${fmt.bold("EXAMPLES:")}
$ ${fmt.dim("npx invariant init")}
$ ${fmt.dim("npx invariant test stripe-webhooks")}
$ ${fmt.dim("INVARIANT_WEBHOOK_SECRET=whsec_xyz npx invariant test stripe-webhooks")}

${fmt.bold("WEBSITE:")}
https://invariant.dev
`);

  process.exit(0);
}

function printVersion() {
  console.log(`Invariant CLI v0.1.0-alpha.1`);
  process.exit(0);
}

switch (command) {
  case "init":
    handleInit();
    break;

  case "test":
    handleTest(subcommand).catch((err) => {
      console.error(`\n❌ ${fmt.red("UNEXPECTED ERROR")}: ${err.message}\n`);
      process.exit(1);
    });
    break;

  case "version":
  case "-v":
  case "--version":
    printVersion();
    break;

  case "help":
  case "-h":
  case "--help":
  default:
    printHelp();
    break;
}
