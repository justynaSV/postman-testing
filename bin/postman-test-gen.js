#!/usr/bin/env node

const program = require("../src/cli");

// Running the CLI with no arguments at all drops straight into the guided
// interactive mode instead of just printing help - friendlier for teammates
// who don't want to memorize flags.
if (process.argv.length <= 2) {
  const { runInteractive } = require("../src/interactive");
  runInteractive().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else {
  program.parseAsync(process.argv).catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
