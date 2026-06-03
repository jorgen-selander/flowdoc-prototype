import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { Narration, WorkflowStep } from "./types";
import { generateMarkdown } from "./markdown";
import { generateSite } from "./site";

// ---------------------------------------------------------------------------
// Engine config
//
// Defaults align with what the Electron shell sets (electron/main.js):
//   FLOWDOC_WHISPER_BIN       -> path to the whisper-cli executable
//   FLOWDOC_WHISPER_MODEL_DIR -> directory the model ggml-*.bin lives in
//
// For the CLI fallback (running `flowdoc transcribe` outside the .app), the
// binary is found relative to dist/ — i.e. in node_modules/nodejs-whisper.
// ---------------------------------------------------------------------------

// "small" is the v2 default: ~500MB download, multilingual, decent Swedish.
const WHISPER_MODEL = "small";
const WHISPER_MODEL_FILE = "ggml-small.bin";
const WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}`;
const WHISPER_MODEL_EXPECTED_SIZE_MB = 500;

function ffmpegBin(): string {
  return process.env.FLOWDOC_FFMPEG || "ffmpeg";
}

function whisperBin(): string {
  if (process.env.FLOWDOC_WHISPER_BIN) return process.env.FLOWDOC_WHISPER_BIN;
  // CLI fallback path — runs from dist/index.js.
  return path.resolve(
    __dirname,
    "..",
    "node_modules",
    "nodejs-whisper",
    "cpp",
    "whisper.cpp",
    "build",
    "bin",
    "whisper-cli",
  );
}

function modelDir(): string {
  if (process.env.FLOWDOC_WHISPER_MODEL_DIR) return process.env.FLOWDOC_WHISPER_MODEL_DIR;
  // CLI fallback location — same path the Electron shell uses on macOS so flows
  // captured via either path share the same model cache.
  return path.join(os.homedir(), "Library", "Application Support", "flowdoc", "whisper-model");
}

function modelPath(): string {
  return path.join(modelDir(), WHISPER_MODEL_FILE);
}

// ---------------------------------------------------------------------------
// Model download (first run only — idempotent on subsequent calls)
// ---------------------------------------------------------------------------

async function ensureModel(): Promise<void> {
  const target = modelPath();
  if (fs.existsSync(target) && fs.statSync(target).size > 100_000_000) {
    return; // already downloaded
  }

  await fs.promises.mkdir(modelDir(), { recursive: true });
  const tmp = target + ".part";
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

  console.log(
    `Downloading transcription model (~${WHISPER_MODEL_EXPECTED_SIZE_MB} MB, one-time, do not quit)...`,
  );

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(tmp);
    let received = 0;
    let total = 0;
    let lastLogged = 0;
    const get = (url: string): void => {
      https
        .get(url, (res) => {
          // HuggingFace returns a 302 to the CDN.
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Model download failed: HTTP ${res.statusCode} from ${url}`));
            res.resume();
            return;
          }
          total = parseInt(res.headers["content-length"] || "0", 10);
          res.on("data", (chunk: Buffer) => {
            received += chunk.length;
            // Log every ~10%, but only if we know the total.
            if (total > 0) {
              const pct = Math.floor((received / total) * 10) * 10;
              if (pct > lastLogged) {
                lastLogged = pct;
                console.log(`  ...${pct}% (${(received / 1_048_576).toFixed(0)} MB)`);
              }
            }
          });
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
        })
        .on("error", reject);
    };
    get(WHISPER_MODEL_URL);
  }).catch((err: Error) => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  });

  fs.renameSync(tmp, target);
  console.log(`Model ready at ${target}.`);
}

// ---------------------------------------------------------------------------
// Audio conversion (.webm → .wav 16kHz mono PCM) using bundled ffmpeg
// ---------------------------------------------------------------------------

async function convertToWav(srcAbs: string): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "flowdoc-whisper-"));
  const dst = path.join(tmpDir, path.basename(srcAbs, path.extname(srcAbs)) + ".wav");
  const r = spawnSync(
    ffmpegBin(),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      srcAbs,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      dst,
    ],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg conversion failed: ${(r.stderr || "").slice(0, 400)}`);
  }
  return dst;
}

// ---------------------------------------------------------------------------
// Per-file transcription via whisper-cli subprocess
// ---------------------------------------------------------------------------

function runWhisperCli(wavPath: string): Promise<string> {
  const bin = whisperBin();
  if (!fs.existsSync(bin)) {
    return Promise.reject(
      new Error(
        `whisper-cli binary not found at ${bin}. Run \`npm install\` and rebuild whisper.cpp.`,
      ),
    );
  }

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(
      bin,
      [
        "-m",
        modelPath(),
        "-f",
        wavPath,
        "-l",
        "sv",
        "-nt", // no timestamps in output
        "-np", // no progress prints
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    proc.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    proc.stderr?.on("data", (chunk: Buffer) => (err += chunk.toString()));
    proc.once("error", reject);
    proc.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`whisper-cli exited with ${code}: ${err.slice(-400)}`));
      } else {
        resolve(out.trim());
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Flow-level orchestration (public API — unchanged from the Python version)
// ---------------------------------------------------------------------------

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

  await ensureModel();

  console.log(`Transcribing ${pending.length} step(s) with whisper-${WHISPER_MODEL} (Swedish)...`);

  const tempWavs: string[] = [];
  try {
    for (let i = 0; i < pending.length; i++) {
      const { step, fingerprint, audioAbs } = pending[i];
      process.stdout.write(`  [${step.index}] step-${String(step.index).padStart(3, "0")} `);
      try {
        const wav = await convertToWav(audioAbs);
        tempWavs.push(wav);
        const text = (await runWhisperCli(wav)).trim();
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
  } finally {
    // Clean up temp wavs + their parent dirs.
    for (const wav of tempWavs) {
      try {
        const dir = path.dirname(wav);
        fs.unlinkSync(wav);
        fs.rmdirSync(dir);
      } catch {
        // ignore
      }
    }
  }

  const name = path.basename(flowDir);
  const startStep = steps.find((s) => s.rawSteps[0]?.action === "start");
  const startUrl = startStep?.url ?? steps[0]?.url ?? "";
  await generateMarkdown({ name, startUrl, steps, outputDir: flowDir });
  await generateSite({ name, startUrl, steps, outputDir: flowDir });

  console.log(`\nDone. README.md and index.html regenerated with transcripts inline.`);
  console.log(`Re-run \`flowdoc miro\` to surface transcripts on the board.`);
}
