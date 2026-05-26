import { spawn, spawnSync, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

const MASTER_FILENAME = "recording.webm";

export interface AudioRecorderOptions {
  outputDir: string;
}

export class AudioRecorder {
  private outputDir: string;
  private audioDir: string;
  private masterPath: string;
  private proc: ChildProcess | null = null;
  private startedAtMs = 0;
  private stoppedAtMs = 0;
  private exited: Promise<void> | null = null;

  constructor(opts: AudioRecorderOptions) {
    this.outputDir = opts.outputDir;
    this.audioDir = path.join(this.outputDir, "audio");
    this.masterPath = path.join(this.audioDir, MASTER_FILENAME);
  }

  async start(): Promise<void> {
    await fs.promises.mkdir(this.audioDir, { recursive: true });
    if (fs.existsSync(this.masterPath)) {
      await fs.promises.unlink(this.masterPath);
    }

    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "avfoundation",
      "-i", ":0",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "libopus",
      "-y",
      this.masterPath,
    ];

    this.proc = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    this.startedAtMs = Date.now();

    let stderrTail = "";
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    this.exited = new Promise<void>((resolve, reject) => {
      this.proc!.once("exit", (code, signal) => {
        if (code !== 0 && signal !== "SIGINT" && signal !== "SIGTERM") {
          reject(new Error(`ffmpeg exited with code ${code}\n${stderrTail}`));
        } else {
          resolve();
        }
      });
      this.proc!.once("error", (err) => reject(err));
    });
  }

  async stop(): Promise<void> {
    if (!this.proc || this.proc.exitCode !== null) return;
    this.stoppedAtMs = Date.now();
    try {
      this.proc.stdin?.write("q\n");
      this.proc.stdin?.end();
    } catch {
      // ignore
    }
    try {
      await Promise.race([
        this.exited,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("ffmpeg stop timeout")), 5000),
        ),
      ]);
    } catch (err) {
      this.proc.kill("SIGKILL");
      throw err;
    }
  }

  getStartedAtMs(): number {
    return this.startedAtMs;
  }

  getStoppedAtMs(): number {
    return this.stoppedAtMs || Date.now();
  }

  getMasterPath(): string {
    return this.masterPath;
  }

  hasRecording(): boolean {
    try {
      const stat = fs.statSync(this.masterPath);
      return stat.size > 0;
    } catch {
      return false;
    }
  }

  /**
   * Split the master recording into per-step files using sliceMs ranges.
   * Returns the relative audioPath (from flow folder) for each step index.
   */
  async sliceByRanges(
    ranges: { stepIndex: number; startMs: number; endMs: number }[],
  ): Promise<Map<number, { audioPath: string; durationMs: number }>> {
    const result = new Map<number, { audioPath: string; durationMs: number }>();
    if (!this.hasRecording()) return result;

    for (const range of ranges) {
      const startSec = Math.max(0, range.startMs / 1000);
      const endSec = Math.max(startSec + 0.05, range.endMs / 1000);
      const filename = `step-${String(range.stepIndex).padStart(3, "0")}.webm`;
      const fullPath = path.join(this.audioDir, filename);

      const sliceArgs = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", this.masterPath,
        "-ss", startSec.toFixed(3),
        "-to", endSec.toFixed(3),
        "-c:a", "libopus",
        fullPath,
      ];

      const r = spawnSync("ffmpeg", sliceArgs, { encoding: "utf-8" });
      if (r.status !== 0) {
        console.warn(
          `  ⚠ failed to slice audio for step ${range.stepIndex}: ${r.stderr?.slice(0, 200)}`,
        );
        continue;
      }
      result.set(range.stepIndex, {
        audioPath: path.posix.join("audio", filename),
        durationMs: Math.round((endSec - startSec) * 1000),
      });
    }
    return result;
  }
}

export function checkFfmpeg(): { ok: boolean; reason?: string } {
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8" });
  if (r.error) {
    return { ok: false, reason: "ffmpeg not found on PATH" };
  }
  if (r.status !== 0) {
    return { ok: false, reason: `ffmpeg returned non-zero exit (${r.status})` };
  }
  return { ok: true };
}
