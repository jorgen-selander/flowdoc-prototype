#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { capture } from "./capture";
import { generateMiro } from "./miro";
import { layoutGraph, mergeGraphs, stepsToGraph } from "./graph";
import { WorkflowStep } from "./types";

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function readSteps(flowFolder: string): WorkflowStep[] {
  const stepsPath = path.join(flowFolder, "workflow-steps.json");
  if (!fs.existsSync(stepsPath)) {
    throw new Error(
      `${stepsPath} not found. Re-run \`flowdoc capture\` for this flow first.`,
    );
  }
  return JSON.parse(fs.readFileSync(stepsPath, "utf-8")) as WorkflowStep[];
}

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
  .option("--no-audio", "Skip microphone narration recording (audio is on by default)")
  .action(async (opts) => {
    await capture({
      url: opts.url,
      name: opts.name,
      outputDir: opts.output,
      debug: opts.debug || false,
      audio: opts.audio !== false,
    });
  });

program
  .command("miro")
  .description("Push a captured flow to a Miro board, optionally merging branch flows")
  .requiredOption("--from <flow-folder>", "Main flow folder (contains workflow-steps.json)")
  .option(
    "--branch <flow-folder>",
    "Alternative branch flow folder, repeatable",
    collect,
    [],
  )
  .requiredOption("--board <board-id>", "Miro board ID")
  .action(async (opts) => {
    const token = process.env.MIRO_ACCESS_TOKEN;
    if (!token) {
      console.error("Error: MIRO_ACCESS_TOKEN env var is required.");
      process.exit(1);
    }

    let mainSteps: WorkflowStep[];
    try {
      mainSteps = readSteps(opts.from);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }

    const branchFolders = opts.branch as string[];
    const branches: { name: string; steps: WorkflowStep[] }[] = [];
    for (let i = 0; i < branchFolders.length; i++) {
      try {
        branches.push({
          name: `branch${i + 1}`,
          steps: readSteps(branchFolders[i]),
        });
      } catch (err) {
        console.error(`Error reading branch "${branchFolders[i]}": ${(err as Error).message}`);
        process.exit(1);
      }
    }

    const mainGraph = stepsToGraph(mainSteps, "main");
    const merged = mergeGraphs(mainGraph, mainSteps, branches);
    const laid = layoutGraph(merged);

    try {
      await generateMiro({ graph: laid, boardId: opts.board, accessToken: token });
    } catch (err) {
      console.error(`\n${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
