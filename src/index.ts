#!/usr/bin/env node

import { Command } from "commander";
import { capture } from "./capture";

const program = new Command();

program
  .name("flowdoc")
  .description("Capture browser workflows and generate Markdown documentation with screenshots")
  .version("1.0.0");

program
  .command("capture")
  .description("Record a browser workflow and generate documentation")
  .requiredOption("--url <url>", "Starting URL to open in the browser")
  .requiredOption("--name <name>", "Name for this flow (used as folder name)")
  .option("--output <dir>", "Output directory", "flowdocs")
  .option("--debug", "Output raw-events.json and workflow-steps.json for debugging")
  .action(async (opts) => {
    await capture({
      url: opts.url,
      name: opts.name,
      outputDir: opts.output,
      debug: opts.debug || false,
    });
  });

program.parse();
