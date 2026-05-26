#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { capture } from "./capture";
import { generateMiro } from "./miro";
import { WorkflowStep } from "./types";

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
  .option("--debug", "Also output raw-events.json for debugging")
  .action(async (opts) => {
    await capture({
      url: opts.url,
      name: opts.name,
      outputDir: opts.output,
      debug: opts.debug || false,
    });
  });

program
  .command("miro")
  .description("Push a captured flow to a Miro board as native shapes and connectors")
  .requiredOption("--from <flow-folder>", "Path to a flow folder containing workflow-steps.json")
  .requiredOption("--board <board-id>", "Miro board ID")
  .action(async (opts) => {
    const token = process.env.MIRO_ACCESS_TOKEN;
    if (!token) {
      console.error("Error: MIRO_ACCESS_TOKEN env var is required.");
      process.exit(1);
    }

    const stepsPath = path.join(opts.from, "workflow-steps.json");
    if (!fs.existsSync(stepsPath)) {
      console.error(
        `Error: ${stepsPath} not found. Re-run \`flowdoc capture\` for this flow first.`,
      );
      process.exit(1);
    }

    let steps: WorkflowStep[];
    try {
      steps = JSON.parse(fs.readFileSync(stepsPath, "utf-8")) as WorkflowStep[];
    } catch (err) {
      console.error(`Error: failed to parse ${stepsPath}: ${(err as Error).message}`);
      process.exit(1);
    }

    try {
      await generateMiro({ steps, boardId: opts.board, accessToken: token });
    } catch (err) {
      console.error(`\n${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
