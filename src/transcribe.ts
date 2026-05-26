import { spawn, spawnSync, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Narration, WorkflowStep } from "./types";
import { generateMarkdown } from "./markdown";
import { generateSite } from "./site";

interface PendingRequest {
  audioPath: string;
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

export class Transcriber {
  private proc: ChildProcess | null = null;
  private stdoutBuffer = "";
  private stderrTail = "";
  private queue: PendingRequest[] = [];
  private active: PendingRequest | null = null;
  private readyPromise: Promise<void> | null = null;
  private exited = false;

  async start(): Promise<void> {
    const python = pickPython();
    if (!python) {
      throw new Error(
        "No working python3 / python on PATH. Install Python 3 (e.g. `brew install python`) and rerun.",
      );
    }

    const scriptPath = path.resolve(__dirname, "..", "scripts", "transcribe.py");
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Transcriber script not found at ${scriptPath}`);
    }

    this.proc = spawn(python, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000);
    });
    this.proc.once("exit", (code, signal) => {
      this.exited = true;
      const err = new Error(
        `transcriber exited (code=${code}, signal=${signal})\n${this.stderrTail}`,
      );
      if (this.active) {
        this.active.reject(err);
        this.active = null;
      }
      for (const p of this.queue) p.reject(err);
      this.queue = [];
    });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    await this.readyPromise;
  }

  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString();
    let nl: number;
    while ((nl = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, nl).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (!line) continue;
      let msg: { ready?: boolean; path?: string; text?: string; error?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      if (msg.ready) {
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
        continue;
      }

      if (msg.error && !msg.path) {
        const err = new Error(msg.error);
        this.readyReject?.(err);
        this.readyReject = null;
        this.readyResolve = null;
        continue;
      }

      const pending = this.active;
      this.active = null;
      if (!pending) continue;

      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.text ?? "");
      }
      this.pump();
    }
  }

  private pump(): void {
    if (this.active || this.queue.length === 0 || this.exited || !this.proc) return;
    const next = this.queue.shift()!;
    this.active = next;
    this.proc.stdin?.write(next.audioPath + "\n");
  }

  transcribe(audioPath: string): Promise<string> {
    if (this.exited) return Promise.reject(new Error("transcriber has exited"));
    return new Promise((resolve, reject) => {
      this.queue.push({ audioPath, resolve, reject });
      this.pump();
    });
  }

  shutdown(): void {
    if (!this.proc || this.exited) return;
    try {
      this.proc.stdin?.end();
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (!this.exited && this.proc) {
        this.proc.kill("SIGTERM");
      }
    }, 1500).unref();
  }
}

function pickPython(): string | null {
  for (const bin of ["python3", "python"]) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf-8" });
    if (r.status === 0) return bin;
  }
  return null;
}

function audioFingerprint(absPath: string): string | null {
  try {
    const stat = fs.statSync(absPath);
    return `${Math.floor(stat.mtimeMs)}:${stat.size}`;
  } catch {
    return null;
  }
}

interface TranscribeOptions {
  flowFolder: string;
}

export async function transcribeFlow(opts: TranscribeOptions): Promise<void> {
  const flowDir = path.resolve(opts.flowFolder);
  const stepsPath = path.join(flowDir, "workflow-steps.json");
  if (!fs.existsSync(stepsPath)) {
    throw new Error(
      `${stepsPath} not found. Run \`flowdoc capture\` for this flow first.`,
    );
  }

  const steps: WorkflowStep[] = JSON.parse(fs.readFileSync(stepsPath, "utf-8"));

  type PendingStep = { step: WorkflowStep; fingerprint: string; audioAbs: string };
  const pending: PendingStep[] = [];
  let missing = 0;
  let alreadyDone = 0;

  for (const step of steps) {
    const n = step.narration;
    if (!n?.audioPath) continue;
    const audioAbs = path.join(flowDir, n.audioPath);
    const fp = audioFingerprint(audioAbs);
    if (!fp) {
      console.warn(`  ⚠ step ${step.index}: audio file ${n.audioPath} missing — skipping.`);
      missing++;
      continue;
    }
    if (n.transcript && n.audioMtime === fp) {
      alreadyDone++;
      continue;
    }
    pending.push({ step, fingerprint: fp, audioAbs });
  }

  if (pending.length === 0) {
    console.log(
      `Nothing to transcribe. ${alreadyDone} step(s) already transcribed${missing ? `, ${missing} audio file(s) missing` : ""}.`,
    );
    return;
  }

  console.log(`Loading whisper model (first run downloads ~3 GB from HuggingFace)...`);
  const transcriber = new Transcriber();

  process.on("SIGINT", () => {
    console.log("\nInterrupted; shutting down transcriber...");
    transcriber.shutdown();
    process.exit(130);
  });

  try {
    await transcriber.start();
  } catch (err) {
    transcriber.shutdown();
    throw err;
  }

  console.log(`Model ready. Transcribing ${pending.length} step(s)...`);

  for (let i = 0; i < pending.length; i++) {
    const { step, fingerprint, audioAbs } = pending[i];
    process.stdout.write(`  [${step.index}] step-${String(step.index).padStart(3, "0")} `);
    try {
      const text = await transcriber.transcribe(audioAbs);
      const updated: Narration = {
        ...(step.narration as Narration),
        transcript: text,
        audioMtime: fingerprint,
      };
      step.narration = updated;
      const preview = text.replace(/\s+/g, " ").slice(0, 60);
      console.log(`✓ "${preview}${text.length > 60 ? "…" : ""}"`);
      await fs.promises.writeFile(stepsPath, JSON.stringify(steps, null, 2));
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`);
    }
  }

  transcriber.shutdown();

  const name = path.basename(flowDir);
  const startStep = steps.find((s) => s.rawSteps[0]?.action === "start");
  const startUrl = startStep?.url ?? steps[0]?.url ?? "";
  await generateMarkdown({ name, startUrl, steps, outputDir: flowDir });
  await generateSite({ name, startUrl, steps, outputDir: flowDir });

  console.log(`\nDone. README.md and index.html regenerated with transcripts inline.`);
  console.log(`Re-run \`flowdoc miro\` to surface transcripts on the board.`);
}
