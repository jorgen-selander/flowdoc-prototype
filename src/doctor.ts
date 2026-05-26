import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import { checkFfmpeg, detectSystemDefaultInputName, resolveMicDevice } from "./audio";
import { hasModule, pickPython, preferredPython, pythonVersion, repoPython } from "./python";

type Status = "ok" | "warn" | "fail";

interface CheckResult {
  name: string;
  status: Status;
  value: string;
  fix?: string;
}

const C = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

const ICON: Record<Status, string> = {
  ok: `${C.green}✓${C.reset}`,
  warn: `${C.yellow}⚠${C.reset}`,
  fail: `${C.red}✗${C.reset}`,
};

const MIN_NODE_MAJOR = 18;

export async function runDoctor(repoRoot: string): Promise<number> {
  const results: CheckResult[] = [];

  results.push(checkNode());
  results.push(checkBuild(repoRoot));
  results.push(checkFfmpegStep());
  results.push(checkMic());
  const py = checkPython();
  results.push(py.result);
  const venv = checkVenv(repoRoot);
  results.push(venv.result);
  results.push(checkPythonDeps(venv.python ?? py.python));
  results.push(await checkPlaywright());
  results.push(checkMiroToken());

  const labelWidth = Math.max(...results.map((r) => r.name.length));
  console.log("");
  for (const r of results) {
    const namePadded = r.name.padEnd(labelWidth + 2, " ");
    console.log(`  ${ICON[r.status]}  ${C.bold}${namePadded}${C.reset}${r.value}`);
    if (r.fix) {
      for (const line of r.fix.split("\n")) {
        console.log(`        ${C.dim}${line}${C.reset}`);
      }
    }
  }

  const counts = {
    ok: results.filter((r) => r.status === "ok").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
  };
  console.log("");
  console.log(
    `  ${C.green}${counts.ok} ok${C.reset}, ${C.yellow}${counts.warn} warning${counts.warn === 1 ? "" : "s"}${C.reset}, ${C.red}${counts.fail} failed${C.reset}.`,
  );
  console.log("");

  return counts.fail > 0 ? 1 : 0;
}

function checkNode(): CheckResult {
  const version = process.version;
  const major = parseInt(version.replace(/^v/, "").split(".")[0], 10);
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) {
    return { name: "Node version", status: "ok", value: version };
  }
  return {
    name: "Node version",
    status: "fail",
    value: `${version} — need >= ${MIN_NODE_MAJOR}.x`,
    fix: "Upgrade Node. With nvm:  nvm install 20 && nvm use 20",
  };
}

function checkBuild(repoRoot: string): CheckResult {
  const distMain = path.join(repoRoot, "dist", "index.js");
  if (fs.existsSync(distMain)) {
    return { name: "Build output", status: "ok", value: "dist/index.js exists" };
  }
  return {
    name: "Build output",
    status: "fail",
    value: "dist/index.js missing",
    fix: "npm install && npm run build",
  };
}

function checkFfmpegStep(): CheckResult {
  const c = checkFfmpeg();
  if (!c.ok) {
    return {
      name: "ffmpeg",
      status: "fail",
      value: c.reason ?? "not found",
      fix: "brew install ffmpeg",
    };
  }
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf-8" });
  const match = (r.stdout ?? "").split("\n")[0]?.match(/ffmpeg version (\S+)/);
  return { name: "ffmpeg", status: "ok", value: match ? match[1] : "installed" };
}

function checkMic(): CheckResult {
  try {
    const resolved = resolveMicDevice();
    const dflt = detectSystemDefaultInputName();
    const suffix = dflt && dflt !== resolved.name ? ` (system default: ${dflt})` : "";
    return {
      name: "System default mic",
      status: "ok",
      value: `${resolved.name} (avfoundation device ${resolved.index})${suffix}`,
    };
  } catch (err) {
    return {
      name: "System default mic",
      status: "warn",
      value: (err as Error).message.split("\n")[0],
      fix: "Connect or enable a microphone, or pass --mic <name-or-index> to flowdoc capture.",
    };
  }
}

function checkPython(): { result: CheckResult; python: string | null } {
  const py = pickPython();
  if (!py) {
    return {
      python: null,
      result: {
        name: "Python",
        status: "fail",
        value: "no python3 / python on PATH",
        fix: "brew install python   (or install from https://www.python.org/downloads/)",
      },
    };
  }
  const version = pythonVersion(py);
  return {
    python: py,
    result: {
      name: "Python",
      status: "ok",
      value: `${py}${version ? ` (${version})` : ""}`,
    },
  };
}

function checkVenv(repoRoot: string): { result: CheckResult; python: string | null } {
  const venvPy = repoPython(repoRoot);
  if (!venvPy) {
    return {
      python: null,
      result: {
        name: "Virtual env",
        status: "fail",
        value: ".venv not found at repo root",
        fix: "python3 -m venv .venv",
      },
    };
  }
  const version = pythonVersion(venvPy);
  return {
    python: venvPy,
    result: {
      name: "Virtual env",
      status: "ok",
      value: `.venv/bin/python${version ? ` (Python ${version})` : ""}`,
    },
  };
}

function checkPythonDeps(python: string | null): CheckResult {
  if (!python) {
    return {
      name: "transformers + torch",
      status: "fail",
      value: "no Python available to check",
      fix: "Resolve the Python / venv check above first.",
    };
  }
  const transformers = hasModule(python, "transformers");
  const torch = hasModule(python, "torch");
  if (transformers.ok && torch.ok) {
    return {
      name: "transformers + torch",
      status: "ok",
      value: `transformers ${transformers.version}, torch ${torch.version}`,
    };
  }
  const missing: string[] = [];
  if (!transformers.ok) missing.push("transformers");
  if (!torch.ok) missing.push("torch");
  return {
    name: "transformers + torch",
    status: "fail",
    value: `missing: ${missing.join(", ")}`,
    fix: "source .venv/bin/activate && pip install -r requirements.txt",
  };
}

async function checkPlaywright(): Promise<CheckResult> {
  try {
    const exe = chromium.executablePath();
    if (exe && fs.existsSync(exe)) {
      return { name: "Playwright Chromium", status: "ok", value: "installed" };
    }
    return {
      name: "Playwright Chromium",
      status: "fail",
      value: "executable not found",
      fix: "npx playwright install chromium",
    };
  } catch (err) {
    return {
      name: "Playwright Chromium",
      status: "fail",
      value: (err as Error).message.split("\n")[0],
      fix: "npx playwright install chromium",
    };
  }
}

function checkMiroToken(): CheckResult {
  const tok = process.env.MIRO_ACCESS_TOKEN;
  if (tok && tok.length > 0) {
    const masked = tok.length > 10 ? `${tok.slice(0, 6)}…${tok.slice(-4)}` : "set";
    return { name: "MIRO_ACCESS_TOKEN", status: "ok", value: masked };
  }
  return {
    name: "MIRO_ACCESS_TOKEN",
    status: "warn",
    value: "not set — required only for `flowdoc miro`",
    fix: "export MIRO_ACCESS_TOKEN='<your-token>'\n(Get one at https://miro.com/app/settings/user-profile/apps → Create new app → Install on team)",
  };
}
