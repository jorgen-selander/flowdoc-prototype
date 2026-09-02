# FlowDoc

Records browser workflows and generates Markdown documentation, a self-contained HTML
site, a Mermaid flowchart, and an optional Miro board. Ships two ways: a CLI (`flowdoc`)
and a signed, notarized macOS desktop app (Electron shell around the same code).

## Tech stack

- TypeScript (strict), compiled with `tsc` to `dist/`
- Playwright (Chromium) for browser automation
- Commander for CLI parsing
- Electron + electron-builder + electron-updater for the desktop app
- whisper.cpp (via `nodejs-whisper`) for local Swedish transcription — no Python
- `ffmpeg-static` for bundled ffmpeg in the packaged app
- No test framework currently

## Build

```bash
npm run build    # tsc
npm run app      # tsc + run Electron against the repo's dist/ (dev loop)
npm run dist     # tsc + bundle Chromium + electron-builder → release/
```

`npm install` runs a `postinstall` that installs Playwright Chromium and compiles
whisper.cpp with cmake (`npm run whisper:build`). cmake is a system dependency on
dev machines and CI.

## Project structure

```
src/
  index.ts          — CLI entry point (commander setup: `capture` / `transcribe` / `site` / `miro` / `doctor` / `ui`)
  capture.ts        — Main capture loop: launches browser, waits for Enter, runs recorder + audio, triggers generation, 30s shutdown watchdog
  recorder.ts       — Injects JS into pages, listens for click/input/navigation events, takes screenshots
  audio.ts          — ffmpeg subprocess wrapper: records mic to audio/recording.webm, slices into per-step files
  transcribe.ts     — whisper.cpp transcription: downloads the model on first run, converts each slice to 16 kHz WAV, shells out to whisper-cli, writes transcripts into workflow-steps.json
  doctor.ts         — `flowdoc doctor` checks: Node/build/ffmpeg/mic/Whisper/Playwright/MIRO token
  ui-server.ts      — HTTP server behind `flowdoc ui` and the desktop app: 127.0.0.1, random port, SSE log stream, /api/{flows,mics,status,start,stop,send-enter,miro-token}, serves /flowdocs/* for site links
  ui-page.ts        — Single-page UI as one HTML string: one card per subcommand, sticky log pane, EventSource consumer
  postprocess.ts    — 4-pass pipeline: dedup clicks → merge click+nav → generate titles → reindex
  markdown.ts       — Generates per-flow README.md with screenshots + narration audio links / transcripts
  site.ts           — Generates self-contained index.html per flow: TOC sidebar, inline <audio>, lightbox screenshots
  mermaid.ts        — Generates flow.mmd flowchart
  notes.ts          — Generates notes-template.md
  graph.ts          — WorkflowStep[] → WorkflowGraph conversion, branch merging (shared-prefix), layout
  miro.ts           — Pushes a WorkflowGraph to Miro using the Unikum brand palette + flowchart symbols
  screenshot.ts     — Screenshot helpers (ensureDir, takeScreenshot)
  types.ts          — Shared interfaces (CaptureOptions, RecordedStep, WorkflowStep, BrowserEvent, Narration, WorkflowNode, WorkflowEdge, WorkflowGraph)
electron/
  main.js           — Desktop shell: boots ui-server in-process, points a BrowserWindow at it, injects bundled ffmpeg/Chromium/whisper paths as env vars, native auto-update dialog + menu
build/
  entitlements.mac.plist — Hardened-runtime entitlements (mic access) for signing
.github/workflows/
  release.yml       — Tag `v*` → build, sign, notarize, publish to GitHub Releases
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
- `--board` accepts either a bare board ID or a pasted board URL — `normalizeBoardId()` in `src/miro.ts` strips the `https://miro.com/app/board/<id>/` wrapper, trailing slashes, query params, and percent-encoding. Without it the full URL lands in the API path and Miro answers 400 "Ambiguous URI path separator"
- Miro export operates on `WorkflowGraph`, not `WorkflowStep[]` directly — linear flows are graphs with one path. Branches (via `--branch`) are merged by shared-prefix detection (matching `url + selector + action type`); branches with no shared prefix or fully contained in main are warned and skipped, not fatal
- Markdown / Mermaid / notes generators remain main-flow-only; branching is a Miro-only concept for now
- Audio narration is recorded live during `flowdoc capture`: ffmpeg (avfoundation on macOS) records the system mic from Enter until Ctrl+C. After recording stops, the master `audio/recording.webm` is sliced into `audio/step-NNN.webm` files using each step's first raw-event timestamp as a boundary. The `narration` field on each `WorkflowStep` points at its slice. Use `--no-audio` to opt out (e.g. when ffmpeg isn't installed).
- Transcription is a separate `flowdoc transcribe <flow-folder>` pass, running fully local via whisper.cpp. Each step's `.webm` slice is converted to 16 kHz mono WAV with ffmpeg, then passed to `whisper-cli` with `-l sv -nt -np`. Results are written into `narration.transcript` and the README + site are regenerated. Idempotent via `narration.audioMtime` (`<mtime>:<size>` fingerprint) — re-running skips steps whose audio hasn't changed.
- The whisper model is **not** bundled: `kb-whisper-medium-q5_0.bin` (~510 MB, Swedish-tuned KBLab model, 5-bit quantized) downloads on first transcribe into `FLOWDOC_WHISPER_MODEL_DIR` (userData in the app, `~/Library/Application Support/flowdoc/whisper-model` for the CLI — deliberately the same path so both share one cache). Keeps app updates small and the model surviving auto-updates. Download emits live speed + ETA with alternating tips/koans every 5 s.
- Binary paths are resolved by env var with a CLI fallback: `FLOWDOC_FFMPEG`, `FLOWDOC_WHISPER_BIN`, `FLOWDOC_WHISPER_MODEL_DIR`, `PLAYWRIGHT_BROWSERS_PATH`. The Electron shell sets all four (`electron/main.js`); running from source falls back to `node_modules/` and PATH. Never hardcode a binary path — add an env var with a fallback.
- Miro export surfaces transcripts: `stepsToGraph()` copies `narration.transcript` onto each `WorkflowNode.transcript`, and `shapeBody()` appends an italic `<p>` line under the shape title when set. Re-running `flowdoc miro` after `flowdoc transcribe` pushes transcripts to the board automatically (no new flag).
- The HTML documentation site (`index.html`) is the primary viewable artifact for narrated flows: inline `<audio controls>` per step, lightbox screenshots, sticky TOC sidebar with scroll-spy. Auto-emitted by `capture` and re-emitted by `transcribe`; `flowdoc site <folder>` regenerates without re-capturing. Single self-contained HTML file (CSS + JS inline) so the flow folder is portable.
- `flowdoc doctor` is the diagnostic command for environment setup — never auto-installs. Prints a 7-row status table with copy-pasteable fix commands; warn (yellow) for non-fatal issues like missing `MIRO_ACCESS_TOKEN`, fail (red, exit 1) for things that block the core flow. The `MIRO_ACCESS_TOKEN` row is skipped when running under Electron (`process.versions.electron`) since the app sets the token via its own field — 6 rows there. See `ONBOARDING.md` for the full setup walkthrough.
- Mic selection is automatic: on startup the macOS system-default input is read from `system_profiler SPAudioDataType` and matched against the avfoundation device list parsed from `ffmpeg -list_devices`. Avoids the trap where avfoundation's `:0` syntax silently grabs a Continuity iPhone mic. Override with `--mic <name-or-index>`; numeric index or case-insensitive substring of the avfoundation device name.
- Encoder settings tuned for voice: 48 kHz mono (matches mic native rate, no real-time resample stutter), Opus in `voip` application mode at 96 kbps, ffmpeg `-thread_queue_size 4096` so the avfoundation input thread isn't starved under Playwright CPU load.
- ffmpeg is stopped with `kill("SIGINT")`, not `q\n` on stdin — the q-command only works when stdin is a TTY, never the case when ffmpeg is spawned from Node. ffmpeg's own SIGINT handler writes the WebM trailer and exits with 255; `intentionalStop` flag on `AudioRecorder` treats that exit as success rather than a false-alarm error.
- Miro export uses the Unikum brand palette: yellow circle (`#FFDB1C`) for the start step, blue rounded rectangle (`#0C69D2`) for pure user actions, light blue rectangle (`#C7DDF4`) for steps that landed on a page (`click → result` or pure `navigation`), green diamond (`#58B456`) for any node with 2+ outgoing edges (auto-detected fork point from `--branch` merges). Borders are transparent. Miro requires `borderWidth > 1` so the value is `2` with `borderOpacity 0` instead of `borderWidth 0` (Miro rejects that).
- Capture shutdown is bulletproof: writes `workflow-steps.json` first before any audio/generator work, wraps each phase in a try/catch + per-phase timeout (4 s pending screenshots, 20 s slicing, 30 s overall watchdog), uses `safeLog`/`safeWarn` so EPIPE on a dead parent pipe doesn't crash the shutdown, `browser.close()` is fire-and-forget (Playwright IPC sometimes stalls; `process.exit(0)` kills Chromium as a side effect anyway).
- `ui-server.ts` is a thin HTTP+SSE wrapper that spawns the same CLI subcommands as children. It takes two roots: `appRoot` (where `dist/index.js` lives — read-only inside the .app when packaged) and `dataRoot` (where flows are written and served from — the repo in dev, userData in the app). Never assume they're the same directory. Single-session model (one subcommand at a time). The output buffer is replayed to new SSE clients so a refresh during a long capture doesn't lose context. `MIRO_ACCESS_TOKEN` can be overridden from the UI for one-off pushes; that override is in-memory only and is lost when the server stops. Strip ANSI escapes from subprocess stdout/stderr before streaming so colored doctor output reads cleanly in the log pane.
- The packaged app carries its own copy of `dist/` inside the bundle. Rebuilding the repo does **not** update an installed `/Applications/FlowDoc.app` — use `npm run app` to test changes, `npm run dist` to repackage.
- Releases are tag-driven: push a `v*` tag and `.github/workflows/release.yml` builds, signs, notarizes, and publishes to GitHub Releases. `mac.target` must include both `dmg` and `zip` — electron-updater needs the zip to apply in-place updates, and omitting it makes auto-update fail silently.
- Debug Electron issues by running from a terminal and reading stdout. The GUI surfaces nothing and macOS unified log does not capture Electron stdout.
- Secrets policy: `.gitignore` blocks `.env`, `*.pem`, `*.key`, `secrets/` — keep tokens out of tracked files
