import { spawn, spawnSync, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

const MASTER_FILENAME = "recording.webm";

export interface AudioRecorderOptions {
  outputDir: string;
  deviceIndex: number;
}

export class AudioRecorder {
  private outputDir: string;
  private audioDir: string;
  private masterPath: string;
  private deviceIndex: number;
  private proc: ChildProcess | null = null;
  private startedAtMs = 0;
  private stoppedAtMs = 0;
  private exited: Promise<void> | null = null;
  private intentionalStop = false;

  constructor(opts: AudioRecorderOptions) {
    this.outputDir = opts.outputDir;
    this.audioDir = path.join(this.outputDir, "audio");
    this.masterPath = path.join(this.audioDir, MASTER_FILENAME);
    this.deviceIndex = opts.deviceIndex;
  }

  async start(): Promise<void> {
    await fs.promises.mkdir(this.audioDir, { recursive: true });
    if (fs.existsSync(this.masterPath)) {
      await fs.promises.unlink(this.masterPath);
    }

    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-thread_queue_size", "4096",
      "-f", "avfoundation",
      "-i", `:${this.deviceIndex}`,
      "-ac", "1",
      "-ar", "48000",
      "-c:a", "libopus",
      "-b:a", "96k",
      "-application", "voip",
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
        // If we asked ffmpeg to stop, any exit is "success" — ffmpeg's SIGINT handler
        // writes the trailer and calls exit(255), which would otherwise look like an error.
        if (this.intentionalStop) {
          resolve();
          return;
        }
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
    this.intentionalStop = true;

    // ffmpeg responds reliably to SIGINT (writes the WebM trailer, exits cleanly).
    // The 'q\n' over stdin only works when stdin is a TTY — when spawned with a piped
    // stdin (which is always our case), ffmpeg often ignores stdin commands.
    try {
      this.proc.kill("SIGINT");
    } catch {
      // ignore
    }

    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ffmpeg stop timeout after 5s")), 5000);
    });
    try {
      await Promise.race([this.exited, timeout]);
      if (timer) clearTimeout(timer);
    } catch (err) {
      if (timer) clearTimeout(timer);
      try {
        this.proc.kill("SIGKILL");
      } catch {
        // ignore
      }
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
        "-b:a", "96k",
        "-application", "voip",
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

export function listAvfoundationAudioDevices(): string[] {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
    { encoding: "utf-8" },
  );
  const out = (r.stderr ?? "") + (r.stdout ?? "");
  const devices: string[] = [];
  let inAudioSection = false;
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (line.includes("AVFoundation audio devices:")) {
      inAudioSection = true;
      continue;
    }
    if (!inAudioSection) continue;
    const m = line.match(/^\[AVFoundation indev @ [^\]]+\]\s+\[(\d+)\]\s+(.+)$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      devices[idx] = m[2].trim();
    }
  }
  return devices;
}

export function detectSystemDefaultInputName(): string | null {
  const r = spawnSync("system_profiler", ["SPAudioDataType"], { encoding: "utf-8" });
  if (r.status !== 0 || !r.stdout) return null;
  const lines = r.stdout.split("\n");
  let currentDevice: string | null = null;
  for (const raw of lines) {
    const deviceMatch = raw.match(/^\s{8}(\S.*?):\s*$/);
    if (deviceMatch) {
      currentDevice = deviceMatch[1].trim();
      continue;
    }
    if (/Default Input Device:\s*Yes/i.test(raw) && currentDevice) {
      return currentDevice;
    }
  }
  return null;
}

export interface ResolvedMic {
  index: number;
  name: string;
}

export function resolveMicDevice(micArg?: string): ResolvedMic {
  const devices = listAvfoundationAudioDevices();
  if (devices.length === 0) {
    throw new Error("No audio input devices found by avfoundation.");
  }

  // Explicit override
  if (micArg) {
    if (/^\d+$/.test(micArg)) {
      const idx = parseInt(micArg, 10);
      if (!devices[idx]) {
        throw new Error(formatDeviceListError(`No avfoundation audio device at index ${idx}.`, devices));
      }
      return { index: idx, name: devices[idx] };
    }
    const needle = micArg.toLowerCase();
    const idx = devices.findIndex((d) => d && d.toLowerCase().includes(needle));
    if (idx === -1) {
      throw new Error(formatDeviceListError(`No avfoundation audio device matching "${micArg}".`, devices));
    }
    return { index: idx, name: devices[idx] };
  }

  // System default
  const defaultName = detectSystemDefaultInputName();
  if (defaultName) {
    const lower = defaultName.toLowerCase();
    const idx = devices.findIndex(
      (d) =>
        d &&
        (d.toLowerCase() === lower ||
          d.toLowerCase().includes(lower) ||
          lower.includes(d.toLowerCase())),
    );
    if (idx !== -1) {
      return { index: idx, name: devices[idx] };
    }
  }

  // Heuristic fallback: prefer the built-in mic over Continuity / virtual devices
  const preferred = ["MacBook Pro Microphone", "MacBook Air Microphone", "Built-in Microphone"];
  for (const candidate of preferred) {
    const idx = devices.findIndex((d) => d === candidate);
    if (idx !== -1) return { index: idx, name: devices[idx] };
  }

  // Last resort: device 0
  return { index: 0, name: devices[0] ?? "device 0" };
}

function formatDeviceListError(prefix: string, devices: string[]): string {
  const list = devices
    .map((d, i) => (d ? `  [${i}] ${d}` : null))
    .filter((s): s is string => s !== null)
    .join("\n");
  return `${prefix}\nAvailable audio input devices:\n${list}`;
}
