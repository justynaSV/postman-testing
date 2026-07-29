#!/usr/bin/env node

const program = require("../src/cli");

program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
