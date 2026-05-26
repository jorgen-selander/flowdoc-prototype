import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export function pickPython(): string | null {
  for (const bin of ["python3", "python"]) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf-8" });
    if (r.status === 0) return bin;
  }
  return null;
}

export function repoPython(repoRoot: string): string | null {
  const candidate = path.join(repoRoot, ".venv", "bin", "python");
  return fs.existsSync(candidate) ? candidate : null;
}

export function preferredPython(repoRoot: string): string | null {
  return repoPython(repoRoot) ?? pickPython();
}

export function pythonVersion(python: string): string | null {
  const r = spawnSync(python, ["--version"], { encoding: "utf-8" });
  if (r.status !== 0) return null;
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).trim();
  const m = out.match(/Python\s+(\S+)/);
  return m ? m[1] : null;
}

export interface ModuleCheck {
  ok: boolean;
  version?: string;
  error?: string;
}

export function hasModule(python: string, moduleName: string): ModuleCheck {
  const script = `import importlib; m = importlib.import_module("${moduleName}"); print(getattr(m, "__version__", "unknown"))`;
  const r = spawnSync(python, ["-c", script], { encoding: "utf-8" });
  if (r.status === 0) {
    return { ok: true, version: (r.stdout ?? "").trim() };
  }
  return { ok: false, error: ((r.stderr ?? "") + (r.stdout ?? "")).trim().slice(0, 400) };
}
