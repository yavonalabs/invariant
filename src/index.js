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
const { handleDoctor } = require("./commands/doctor");
const { printSetupHelp } = require("./utils/support");

const args = process.argv.slice(2);

const command = args[0] ? args[0].toLowerCase() : "help";
function parseOptions(values) {
  const options = {};
  let suite = "payment";
  let foundSuite = false;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === "--ci") continue;
    if (value === "--config" || value === "--report-dir") {
      if (!values[i + 1] || values[i + 1].startsWith("--")) throw new Error(`${value} requires a path`);
      options[value === "--config" ? "config" : "reportDir"] = values[++i];
    } else if (!value.startsWith("-") && !foundSuite) {
      suite = value.toLowerCase();
      foundSuite = true;
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return { suite, options };
}

function printHelp() {
  fmt.banner();

  console.log(`
${fmt.bold("USAGE:")}
$ npx @yavona/invariant <command> [subcommand] [options]

${fmt.bold("COMMANDS:")}
${fmt.cyan("demo")}                    Run the local concurrent-balance comparison demo
${fmt.cyan("init")}                    Generate template invariant.config.js in project
${fmt.cyan("doctor [payment]")}        Diagnose config and probe fields without sending webhooks
${fmt.cyan("test stripe-webhooks")}    Execute provider-accurate Stripe webhook state assertions
${fmt.cyan("test razorpay-webhooks")}  Execute provider-accurate Razorpay webhook state assertions
${fmt.cyan("test payment")}            Execute payment webhook state assertions using config provider
${fmt.cyan("version / --version")}       Print Invariant CLI version
${fmt.cyan("help    / --help")}          Print CLI usage & help options

${fmt.bold("EXAMPLES:")}
$ npx @yavona/invariant demo
$ npx @yavona/invariant init
$ npx @yavona/invariant test stripe-webhooks
$ npx @yavona/invariant doctor --config invariant.config.js
$ npx @yavona/invariant test payment --report-dir ./reports --ci
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
    case "doctor": {
      let parsed;
      try { parsed = parseOptions(args.slice(1)); }
      catch (error) {
        console.error(`CONFIG ERROR: ${error.message}`);
        printSetupHelp();
        process.exitCode = 2;
        break;
      }
      if (command === "doctor") await handleDoctor(parsed.suite, parsed.options);
      else await handleTest(parsed.suite, parsed.options);
      break;
    }

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
