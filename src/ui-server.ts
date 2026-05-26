import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { AddressInfo } from "net";
import { spawn, ChildProcess } from "child_process";
import { UI_HTML } from "./ui-page";
import { detectSystemDefaultInputName, listAvfoundationAudioDevices } from "./audio";

interface OutputLine {
  stream: "stdout" | "stderr" | "system";
  text: string;
  t: number;
}

interface Session {
  name: string;
  args: string[];
  child: ChildProcess;
  startedAt: number;
  output: OutputLine[];
  started: boolean;
  exitCode: number | null;
}

interface FlowInfo {
  name: string;
  stepCount: number;
  hasAudio: boolean;
  hasTranscripts: boolean;
}

const OUTPUT_CAP = 5000;
const ALLOWED_COMMANDS = new Set(["capture", "transcribe", "site", "miro", "doctor"]);

const streamClients = new Set<http.ServerResponse>();
let session: Session | null = null;
let miroTokenOverride: string | null = null;

export async function runUi(repoRoot: string): Promise<void> {
  const distMain = path.join(repoRoot, "dist", "index.js");
  if (!fs.existsSync(distMain)) {
    console.error(`Error: ${distMain} not found. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res, repoRoot).catch((err) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
      }
      res.end(JSON.stringify({ error: err.message }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/`;
  console.log(`\nFlowDoc UI: ${url}\n`);

  try {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // open might not exist (non-macOS) — user can still copy the URL
  }

  const shutdown = () => {
    if (session && session.exitCode === null) {
      try {
        session.child.kill("SIGINT");
      } catch {
        // ignore
      }
    }
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  repoRoot: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(UI_HTML);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/flowdocs/")) {
    await serveFlowFile(url.pathname, repoRoot, res);
    return;
  }

  if (route === "GET /api/flows") {
    json(res, listFlows(repoRoot));
    return;
  }

  if (route === "GET /api/mics") {
    const devices = listAvfoundationAudioDevices();
    const defaultName = detectSystemDefaultInputName();
    let defaultIndex = -1;
    if (defaultName) {
      const lower = defaultName.toLowerCase();
      defaultIndex = devices.findIndex(
        (d) =>
          d &&
          (d.toLowerCase() === lower ||
            d.toLowerCase().includes(lower) ||
            lower.includes(d.toLowerCase())),
      );
    }
    json(res, { devices, defaultName, defaultIndex });
    return;
  }

  if (route === "GET /api/status") {
    json(res, statusPayload());
    return;
  }

  if (route === "GET /api/stream") {
    setupSseStream(req, res);
    return;
  }

  if (route === "POST /api/start") {
    const body = await readBody(req);
    let parsed: { command?: string; args?: Record<string, unknown> };
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      res.statusCode = 400;
      json(res, { error: "Invalid JSON body" });
      return;
    }
    const command = parsed.command ?? "";
    const args = (parsed.args ?? {}) as Record<string, unknown>;
    if (!ALLOWED_COMMANDS.has(command)) {
      res.statusCode = 400;
      json(res, { error: `Unknown command: ${command}` });
      return;
    }
    if (session && session.exitCode === null) {
      res.statusCode = 409;
      json(res, { error: "A session is already active. Stop it first." });
      return;
    }
    try {
      const cliArgs = buildCliArgs(command, args);
      startSession(repoRoot, command, cliArgs);
      json(res, { ok: true });
    } catch (err) {
      res.statusCode = 400;
      json(res, { error: (err as Error).message });
    }
    return;
  }

  if (route === "POST /api/send-enter") {
    if (!session || session.exitCode !== null || !session.child.stdin) {
      res.statusCode = 409;
      json(res, { error: "No active session." });
      return;
    }
    session.child.stdin.write("\n");
    session.started = true;
    json(res, { ok: true });
    return;
  }

  if (route === "POST /api/stop") {
    if (!session || session.exitCode !== null) {
      res.statusCode = 409;
      json(res, { error: "No active session." });
      return;
    }
    session.child.kill("SIGINT");
    json(res, { ok: true });
    return;
  }

  if (route === "POST /api/miro-token") {
    const body = await readBody(req);
    let parsed: { token?: string };
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      res.statusCode = 400;
      json(res, { error: "Invalid JSON body" });
      return;
    }
    miroTokenOverride = parsed.token && parsed.token.length > 0 ? parsed.token : null;
    json(res, { ok: true, miroTokenSet: hasMiroToken() });
    return;
  }

  res.statusCode = 404;
  json(res, { error: "Not found" });
}

function setupSseStream(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (session) {
    for (const line of session.output) {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    }
    if (session.exitCode !== null) {
      res.write(
        `data: ${JSON.stringify({ stream: "system", text: `__DONE__ ${session.exitCode}`, t: 0 })}\n\n`,
      );
    }
  }

  streamClients.add(res);
  const cleanup = () => {
    streamClients.delete(res);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

function startSession(repoRoot: string, command: string, args: string[]): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (miroTokenOverride) env.MIRO_ACCESS_TOKEN = miroTokenOverride;

  const child = spawn(
    process.execPath,
    [path.join(repoRoot, "dist", "index.js"), command, ...args],
    {
      env,
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const startedAt = Date.now();
  const newSession: Session = {
    name: command,
    args,
    child,
    startedAt,
    output: [],
    started: false,
    exitCode: null,
  };
  session = newSession;

  const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
  const lineReader = (stream: "stdout" | "stderr") => {
    let buf = "";
    return (chunk: Buffer) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const text = buf.slice(0, idx).replace(ANSI_RE, "");
        buf = buf.slice(idx + 1);
        emit(newSession, { stream, text, t: Date.now() - startedAt });
      }
    };
  };

  child.stdout?.on("data", lineReader("stdout"));
  child.stderr?.on("data", lineReader("stderr"));

  child.once("exit", (code) => {
    if (newSession.exitCode === null) {
      newSession.exitCode = code ?? -1;
    }
    emit(newSession, {
      stream: "system",
      text: `__DONE__ ${newSession.exitCode}`,
      t: Date.now() - startedAt,
    });
  });

  child.once("error", (err) => {
    emit(newSession, {
      stream: "stderr",
      text: `Failed to start subprocess: ${err.message}`,
      t: Date.now() - startedAt,
    });
    if (newSession.exitCode === null) {
      newSession.exitCode = -1;
    }
  });
}

function emit(s: Session, line: OutputLine): void {
  s.output.push(line);
  if (s.output.length > OUTPUT_CAP) s.output.shift();
  for (const res of streamClients) {
    try {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    } catch {
      // client gone; cleanup happens via 'close'
    }
  }
}

function buildCliArgs(command: string, args: Record<string, unknown>): string[] {
  switch (command) {
    case "capture": {
      const url = String(args.url ?? "").trim();
      const name = String(args.name ?? "").trim();
      if (!url) throw new Error("URL is required");
      if (!name) throw new Error("Name is required");
      const out: string[] = ["--url", url, "--name", name];
      if (args.noAudio) out.push("--no-audio");
      if (args.mic && String(args.mic).trim()) out.push("--mic", String(args.mic).trim());
      if (args.debug) out.push("--debug");
      return out;
    }
    case "transcribe": {
      const flow = String(args.flow ?? "").trim();
      if (!flow) throw new Error("Flow folder is required");
      return [path.join("flowdocs", flow)];
    }
    case "site": {
      const flow = String(args.flow ?? "").trim();
      if (!flow) throw new Error("Flow folder is required");
      return [path.join("flowdocs", flow)];
    }
    case "miro": {
      const flow = String(args.flow ?? "").trim();
      const board = String(args.board ?? "").trim();
      if (!flow) throw new Error("Main flow is required");
      if (!board) throw new Error("Board ID is required");
      const out: string[] = ["--from", path.join("flowdocs", flow)];
      const branches = Array.isArray(args.branches) ? (args.branches as string[]) : [];
      for (const b of branches) {
        if (b && typeof b === "string" && b.trim()) {
          out.push("--branch", path.join("flowdocs", b.trim()));
        }
      }
      out.push("--board", board);
      return out;
    }
    case "doctor":
      return [];
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function listFlows(repoRoot: string): FlowInfo[] {
  const dir = path.join(repoRoot, "flowdocs");
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const flows: FlowInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const stepsPath = path.join(dir, e.name, "workflow-steps.json");
    let stepCount = 0;
    let hasAudio = false;
    let hasTranscripts = false;
    try {
      const raw = fs.readFileSync(stepsPath, "utf-8");
      const steps = JSON.parse(raw) as Array<{
        narration?: { audioPath?: string; transcript?: string };
      }>;
      stepCount = steps.length;
      hasAudio = steps.some((s) => !!s.narration?.audioPath);
      hasTranscripts = steps.some((s) => !!s.narration?.transcript);
    } catch {
      // No workflow-steps.json yet or unreadable; just count as 0.
    }
    flows.push({ name: e.name, stepCount, hasAudio, hasTranscripts });
  }
  flows.sort((a, b) => a.name.localeCompare(b.name));
  return flows;
}

function statusPayload(): object {
  if (!session) {
    return { idle: true, miroTokenSet: hasMiroToken() };
  }
  return {
    idle: session.exitCode !== null,
    name: session.name,
    args: session.args,
    startedAt: session.startedAt,
    started: session.started,
    output: session.output,
    exitCode: session.exitCode,
    miroTokenSet: hasMiroToken(),
  };
}

function hasMiroToken(): boolean {
  return !!(miroTokenOverride || process.env.MIRO_ACCESS_TOKEN);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".md": "text/markdown; charset=utf-8",
  ".mmd": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

async function serveFlowFile(
  pathname: string,
  repoRoot: string,
  res: http.ServerResponse,
): Promise<void> {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("..")) {
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }
  const rel = decoded.replace(/^\//, "");
  const filePath = path.join(repoRoot, rel);
  const flowdocsRoot = path.join(repoRoot, "flowdocs");
  if (!filePath.startsWith(flowdocsRoot + path.sep) && filePath !== flowdocsRoot) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, body: unknown): void {
  if (!res.headersSent) {
    res.setHeader("Content-Type", "application/json");
  }
  res.end(JSON.stringify(body));
}
