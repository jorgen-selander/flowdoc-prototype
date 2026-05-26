import { chromium } from "playwright";
import * as readline from "readline";
import * as fs from "fs";
import { CaptureOptions, WorkflowStep } from "./types";
import { Recorder } from "./recorder";
import { postprocess } from "./postprocess";
import { generateMarkdown } from "./markdown";
import { generateMermaid } from "./mermaid";
import { generateNotes } from "./notes";
import { generateSite } from "./site";
import { ensureScreenshotDir } from "./screenshot";
import { AudioRecorder, checkFfmpeg, resolveMicDevice } from "./audio";
import * as path from "path";

export async function capture(options: CaptureOptions): Promise<void> {
  const { url, name, outputDir, debug, audio, mic } = options;
  const flowDir = path.join(outputDir, name);

  await ensureScreenshotDir(flowDir);

  let audioRecorder: AudioRecorder | null = null;
  let audioWanted = audio;
  let resolvedMic: { index: number; name: string } | null = null;
  if (audioWanted) {
    const check = checkFfmpeg();
    if (!check.ok) {
      console.warn(`\n⚠ Audio recording disabled: ${check.reason}.`);
      console.warn(`  Install ffmpeg (e.g. \`brew install ffmpeg\`) and rerun without --no-audio to enable narration.`);
      audioWanted = false;
    } else {
      try {
        resolvedMic = resolveMicDevice(mic);
        console.log(`\n🎙  Audio input: ${resolvedMic.name} (avfoundation device ${resolvedMic.index})`);
      } catch (err) {
        console.warn(`\n⚠ ${(err as Error).message}`);
        console.warn(`  Continuing without audio.`);
        audioWanted = false;
      }
    }
  }

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
      try {
        console.log("\n(Shutdown already in progress; ignoring duplicate stop request.)");
      } catch {
        // stdout may be EPIPE if parent died; ignore
      }
      return;
    }
    isShuttingDown = true;

    // Watchdog: if anything in runShutdown hangs past 30 s, force-exit. unref() so the
    // timer doesn't keep the event loop alive on its own.
    const watchdog = setTimeout(() => {
      try {
        console.warn("\n  ⚠ Shutdown watchdog tripped after 30s; force-exiting.");
      } catch {
        // ignore
      }
      process.exit(0);
    }, 30000);
    watchdog.unref();

    try {
      await runShutdown();
    } catch (err) {
      try {
        console.error(`\n  ⚠ Shutdown error: ${(err as Error).message}`);
      } catch {
        // ignore
      }
    } finally {
      clearTimeout(watchdog);
      process.exit(0);
    }
  }

  async function runShutdown() {
    safeLog("\n\nStopping recording...");
    recorder.stop();

    // Brief wait for any in-flight screenshot so the last step lands in rawSteps.
    await withTimeout(recorder.waitForPending(), 4000, "pending screenshots").catch((err) => {
      safeWarn(`  ⚠ ${err.message} — proceeding with what we have.`);
    });

    // PERSIST RAW STEPS FIRST. Everything below this is best-effort; if anything fails or the
    // parent process kills us, the captured workflow is already on disk.
    const rawSteps = recorder.getSteps();
    let workflowSteps: ReturnType<typeof postprocess> = [];
    if (rawSteps.length > 0) {
      workflowSteps = postprocess(rawSteps);
      try {
        await fs.promises.writeFile(
          path.join(flowDir, "workflow-steps.json"),
          JSON.stringify(workflowSteps, null, 2),
        );
        safeLog(`Saved workflow-steps.json (${workflowSteps.length} steps).`);
      } catch (err) {
        safeWarn(`  ⚠ failed to write workflow-steps.json: ${(err as Error).message}`);
      }
    }

    if (audioRecorder) {
      safeLog("Finalizing audio…");
      try {
        await audioRecorder.stop();
      } catch (err) {
        safeWarn(`  ⚠ ffmpeg stop error: ${(err as Error).message}`);
      }
    }

    if (rawSteps.length > 0) {
      if (audioRecorder && audioRecorder.hasRecording()) {
        safeLog("Slicing audio into per-step segments…");
        try {
          await withTimeout(attachNarration(workflowSteps, audioRecorder), 20000, "audio slicing");
          // Re-save with narration attached.
          await fs.promises.writeFile(
            path.join(flowDir, "workflow-steps.json"),
            JSON.stringify(workflowSteps, null, 2),
          );
        } catch (err) {
          safeWarn(`  ⚠ ${(err as Error).message} — continuing without per-step audio.`);
        }
      }

      const stepCount = workflowSteps.filter((s) => s.rawSteps[0].action !== "start").length;
      safeLog(`Generating documentation (${stepCount} workflow steps from ${rawSteps.length} raw events)…`);

      let readmePath = "";
      let sitePath = "";
      try {
        readmePath = await generateMarkdown({ name, startUrl: url, steps: workflowSteps, outputDir: flowDir });
        await generateMermaid({ steps: workflowSteps, outputDir: flowDir });
        await generateNotes({ name, steps: workflowSteps, outputDir: flowDir });
        sitePath = await generateSite({ name, startUrl: url, steps: workflowSteps, outputDir: flowDir });
      } catch (err) {
        safeWarn(`  ⚠ Generator error: ${(err as Error).message}`);
      }

      if (debug) {
        try {
          await fs.promises.writeFile(
            path.join(flowDir, "raw-events.json"),
            JSON.stringify(rawSteps, null, 2),
          );
          safeLog("Debug file written: raw-events.json");
        } catch (err) {
          safeWarn(`  ⚠ failed to write raw-events.json: ${(err as Error).message}`);
        }
      }

      safeLog(`\nDone! ${stepCount} workflow steps captured.`);
      if (readmePath) safeLog(`Documentation:  ${readmePath}`);
      if (sitePath) safeLog(`Site:           ${sitePath}`);
      safeLog(`Flowchart:      ${path.join(flowDir, "flow.mmd")}`);
      safeLog(`Notes template: ${path.join(flowDir, "notes-template.md")}`);
      safeLog(`Screenshots:    ${path.join(flowDir, "screenshots")}/`);
      if (audioRecorder && audioRecorder.hasRecording()) {
        safeLog(`Audio:          ${path.join(flowDir, "audio")}/`);
      }
    } else {
      safeLog("No steps were recorded.");
    }

    safeLog("Closing browser…");
    // Fire-and-forget: process.exit(0) below will kill the Chromium subprocess
    // anyway, and awaiting browser.close() can hang for reasons unclear to us
    // (Playwright IPC stalling, etc.). Don't let it block our exit.
    browser.close().catch(() => {
      // ignore — the process is about to die anyway
    });
  }

  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      p.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }

  function safeLog(msg: string): void {
    try { console.log(msg); } catch { /* EPIPE etc. */ }
  }
  function safeWarn(msg: string): void {
    try { console.warn(msg); } catch { /* EPIPE etc. */ }
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

  if (audioWanted && resolvedMic) {
    audioRecorder = new AudioRecorder({ outputDir: flowDir, deviceIndex: resolvedMic.index });
    try {
      await audioRecorder.start();
      console.log(`🎙  Audio recording started (${resolvedMic.name}).`);
    } catch (err) {
      console.warn(`⚠ Audio recording failed to start: ${(err as Error).message}`);
      console.warn(`  Continuing without audio.`);
      audioRecorder = null;
    }
  }

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

async function attachNarration(
  workflowSteps: WorkflowStep[],
  audioRecorder: AudioRecorder,
): Promise<void> {
  const audioStart = audioRecorder.getStartedAtMs();
  const audioEnd = audioRecorder.getStoppedAtMs();

  const ranges = workflowSteps.map((step, i) => {
    const startMs = (step.rawSteps[0]?.timestamp ?? audioStart) - audioStart;
    const next = workflowSteps[i + 1];
    const endMs = next
      ? (next.rawSteps[0]?.timestamp ?? audioEnd) - audioStart
      : audioEnd - audioStart;
    return { stepIndex: step.index, startMs, endMs };
  });

  const sliced = await audioRecorder.sliceByRanges(ranges);
  const recordedAtBase = new Date(audioStart);

  for (const step of workflowSteps) {
    const slice = sliced.get(step.index);
    if (!slice) continue;
    const range = ranges.find((r) => r.stepIndex === step.index)!;
    step.narration = {
      audioPath: slice.audioPath,
      durationMs: slice.durationMs,
      recordedAt: new Date(recordedAtBase.getTime() + range.startMs).toISOString(),
    };
  }
}
