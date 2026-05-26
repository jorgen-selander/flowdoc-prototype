# FlowDoc

CLI tool that records browser workflows and generates Markdown documentation with screenshots.

## Tech stack

- TypeScript (strict), compiled with `tsc` to `dist/`
- Playwright (Chromium) for browser automation
- Commander for CLI parsing
- No test framework currently

## Build

```bash
npm run build    # tsc
```

## Project structure

```
src/
  index.ts          — CLI entry point (commander setup, `capture` + `transcribe` + `site` + `miro` + `doctor` subcommands)
  capture.ts        — Main capture loop: launches browser, waits for Enter, runs recorder + audio, triggers generation
  recorder.ts       — Injects JS into pages, listens for click/input/navigation events, takes screenshots
  audio.ts          — ffmpeg subprocess wrapper: records mic to audio/recording.webm, slices into per-step files
  transcribe.ts     — Spawns scripts/transcribe.py (via preferredPython), queues audio paths, writes transcripts into workflow-steps.json
  python.ts         — Shared Python helpers: pickPython, repoPython, preferredPython, hasModule
  doctor.ts         — `flowdoc doctor` checks: Node/build/ffmpeg/mic/Python/venv/transformers/Playwright/MIRO token
  postprocess.ts    — 4-pass pipeline: dedup clicks → merge click+nav → generate titles → reindex
  markdown.ts       — Generates per-flow README.md with screenshots + narration audio links / transcripts
  site.ts           — Generates self-contained index.html per flow: TOC sidebar, inline <audio>, lightbox screenshots
  mermaid.ts        — Generates flow.mmd flowchart
  notes.ts          — Generates notes-template.md
  graph.ts          — WorkflowStep[] → WorkflowGraph conversion, branch merging (shared-prefix), layout
  miro.ts           — Pushes a WorkflowGraph to Miro as native shapes + connectors via REST v2
  screenshot.ts    — Screenshot helpers (ensureDir, takeScreenshot)
  types.ts          — Shared interfaces (CaptureOptions, RecordedStep, WorkflowStep, BrowserEvent, Narration, WorkflowNode, WorkflowEdge, WorkflowGraph)
scripts/
  transcribe.py     — Long-lived Python worker: loads KBLab/kb-whisper-large once, reads audio paths on stdin, writes JSON results on stdout
requirements.txt    — transformers + torch pins for the Python transcriber
.env.example        — Template listing the env vars FlowDoc consumes (MIRO_ACCESS_TOKEN). `.env` itself stays gitignored.
```

## Key conventions

- Output goes to `flowdocs/<name>/` by default (gitignored)
- `workflow-steps.json` is always emitted by `capture` (the `miro` subcommand reads it); `raw-events.json` is only emitted with `--debug`
- Recording always waits for Enter before starting (no flag needed)
- Post-processing detects both explicit navigations and silent URL changes (SPA-style)
- Passwords are masked as `********` in recordings
- Screenshots use `step-NNN.png` naming
- Miro export reads `MIRO_ACCESS_TOKEN` from env, creates shapes sequentially with a soft rate-limit cushion, never deletes existing board items
- Miro export operates on `WorkflowGraph`, not `WorkflowStep[]` directly — linear flows are graphs with one path. Branches (via `--branch`) are merged by shared-prefix detection (matching `url + selector + action type`); branches with no shared prefix or fully contained in main are warned and skipped, not fatal
- Markdown / Mermaid / notes generators remain main-flow-only; branching is a Miro-only concept for now
- Audio narration is recorded live during `flowdoc capture`: ffmpeg (avfoundation on macOS) records the system mic from Enter until Ctrl+C. After recording stops, the master `audio/recording.webm` is sliced into `audio/step-NNN.webm` files using each step's first raw-event timestamp as a boundary. The `narration` field on each `WorkflowStep` points at its slice. Use `--no-audio` to opt out (e.g. when ffmpeg isn't installed).
- Transcription is a separate `flowdoc transcribe <flow-folder>` pass. Spawns a long-lived Python subprocess (`scripts/transcribe.py`) that loads `KBLab/kb-whisper-large` once, then transcribes each step's audio over a JSON-line stdin/stdout protocol. Results are written into `narration.transcript` and the README is regenerated with transcript blockquotes. Idempotent via `narration.audioMtime` (`<mtime>:<size>` fingerprint) — re-running skips steps whose audio hasn't changed.
- Miro export surfaces transcripts: `stepsToGraph()` copies `narration.transcript` onto each `WorkflowNode.transcript`, and `shapeBody()` appends an italic `<p>` line under the shape title when set. Re-running `flowdoc miro` after `flowdoc transcribe` pushes transcripts to the board automatically (no new flag).
- The HTML documentation site (`index.html`) is the primary viewable artifact for narrated flows: inline `<audio controls>` per step, lightbox screenshots, sticky TOC sidebar with scroll-spy. Auto-emitted by `capture` and re-emitted by `transcribe`; `flowdoc site <folder>` regenerates without re-capturing. Single self-contained HTML file (CSS + JS inline) so the flow folder is portable.
- `flowdoc doctor` is the diagnostic command for environment setup — never auto-installs. Prints a 9-row status table with copy-pasteable fix commands; warn (yellow) for non-fatal issues like missing `MIRO_ACCESS_TOKEN`, fail (red, exit 1) for things that block the core flow. New teammates should run it first; see `ONBOARDING.md` for the full setup walkthrough.
- Python resolution lives in `src/python.ts`: `preferredPython(repoRoot)` returns `.venv/bin/python` if present, falling back to `python3`/`python` on PATH. Both `flowdoc transcribe` and `flowdoc doctor` use it, so teammates don't need to `source .venv/bin/activate` every session — the venv is auto-detected.
- Mic selection is automatic: on startup the macOS system-default input is read from `system_profiler SPAudioDataType` and matched against the avfoundation device list parsed from `ffmpeg -list_devices`. Avoids the trap where avfoundation's `:0` syntax silently grabs a Continuity iPhone mic. Override with `--mic <name-or-index>`; numeric index or case-insensitive substring of the avfoundation device name.
- Encoder settings tuned for voice: 48 kHz mono (matches mic native rate, no real-time resample stutter), Opus in `voip` application mode at 96 kbps, ffmpeg `-thread_queue_size 4096` so the avfoundation input thread isn't starved under Playwright CPU load.
- Secrets policy: `.gitignore` blocks `.env`, `*.pem`, `*.key`, `secrets/` — keep tokens out of tracked files
