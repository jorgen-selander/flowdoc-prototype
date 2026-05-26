import { chromium } from "playwright";
import * as readline from "readline";
import * as fs from "fs";
import { CaptureOptions } from "./types";
import { Recorder } from "./recorder";
import { postprocess } from "./postprocess";
import { generateMarkdown } from "./markdown";
import { generateMermaid } from "./mermaid";
import { generateNotes } from "./notes";
import { ensureScreenshotDir } from "./screenshot";
import * as path from "path";

export async function capture(options: CaptureOptions): Promise<void> {
  const { url, name, outputDir, debug } = options;
  const flowDir = path.join(outputDir, name);

  await ensureScreenshotDir(flowDir);

  console.log(`\nLaunching browser...`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  const recorder = new Recorder(flowDir);
  let isShuttingDown = false;

  async function shutdown() {
    if (isShuttingDown) {
      console.log("\nForce exiting...");
      process.exit(1);
    }
    isShuttingDown = true;
    console.log("\n\nStopping recording...");
    recorder.stop();
    await recorder.waitForPending();

    const rawSteps = recorder.getSteps();
    if (rawSteps.length > 0) {
      console.log("Processing captured steps...");
      const workflowSteps = postprocess(rawSteps);
      const stepCount = workflowSteps.filter((s) => s.rawSteps[0].action !== "start").length;
      console.log(`Generating documentation (${stepCount} workflow steps from ${rawSteps.length} raw events)...`);

      const readmePath = await generateMarkdown({
        name,
        startUrl: url,
        steps: workflowSteps,
        outputDir: flowDir,
      });
      await generateMermaid({ steps: workflowSteps, outputDir: flowDir });
      await generateNotes({ name, steps: workflowSteps, outputDir: flowDir });

      if (debug) {
        await fs.promises.writeFile(
          path.join(flowDir, "raw-events.json"),
          JSON.stringify(rawSteps, null, 2)
        );
        await fs.promises.writeFile(
          path.join(flowDir, "workflow-steps.json"),
          JSON.stringify(workflowSteps, null, 2)
        );
        console.log("Debug files written: raw-events.json, workflow-steps.json");
      }

      console.log(`\nDone! ${stepCount} workflow steps captured.`);
      console.log(`Documentation:  ${readmePath}`);
      console.log(`Flowchart:      ${path.join(flowDir, "flow.mmd")}`);
      console.log(`Notes template: ${path.join(flowDir, "notes-template.md")}`);
      console.log(`Screenshots:    ${path.join(flowDir, "screenshots")}/`);
    } else {
      console.log("No steps were recorded.");
    }

    await browser.close().catch(() => {});
    process.exit(0);
  }

  process.on("SIGINT", shutdown);

  // Also handle browser window being closed by the user
  context.on("close", async () => {
    if (!isShuttingDown) {
      await shutdown();
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log(`Opened: ${url}\n`);

  console.log("Browse freely. Log in, dismiss popups, navigate to the starting point.");
  console.log("Press Enter in this terminal when you are ready to start recording...\n");

  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once("line", () => {
      rl.close();
      resolve();
    });
  });

  console.log("Recording started!\n");

  // Set up recorder on the page and context
  await recorder.setupPage(page);
  recorder.setupContext(context);

  // Record the starting state
  const currentUrl = page.url();
  await recorder.recordStartStep(page, currentUrl);

  console.log("\nRecording browser actions. Press Ctrl+C to stop and generate docs.\n");

  // Keep the process alive
  await new Promise(() => {});
}
