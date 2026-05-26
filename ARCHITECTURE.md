# FlowDoc — How it works

A walkthrough of the moving parts behind `flowdoc capture` and `flowdoc miro`, written so the design choices are explainable without reading the source.

## The architecture in one sentence

FlowDoc launches a real Chromium browser, injects a JavaScript snitch into every page, listens for the user's clicks/inputs/navigations from Node via a bidirectional bridge, screenshots each event, records voice narration from the system mic via an ffmpeg subprocess in parallel, then post-processes the raw event stream into clean steps that get rendered to Markdown, Mermaid, JSON, and Miro.

## Playwright's job

Playwright is doing four distinct things, none of them obvious from the README:

1. **Launches a visible browser** — `chromium.launch({ headless: false, args: ["--start-maximized"] })` in `src/capture.ts`. Not headless: the user *is* the test driver. The `viewport: null` on the context tells Playwright "don't override the window size with your default 1280×720, use whatever the OS gives you" — that's what lets the maximized window matter.

2. **Creates a Node ↔ browser bridge** — `page.exposeFunction("__flowdoc_report", callback)` in `src/recorder.ts`. That single line creates a function called `__flowdoc_report` *inside the browser's JavaScript world* that, when called, invokes a Node callback. Playwright serialises the argument across the process boundary. This is the trick that makes recording possible: the browser-side script can shout events back to Node, and Node decides what to do with them.

3. **Injects the recording script into every page** — two flavours:
   - `page.addInitScript(INJECTED_SCRIPT)` — runs the script on every *future* page load, including after the user clicks a link that navigates away.
   - `page.evaluate(INJECTED_SCRIPT)` — runs it on the *current* page right now. Needed because `addInitScript` only fires on the next navigation, and the page is already loaded by the time the user presses Enter. (This bug was the first thing that broke in early testing — see `BUILD_LOG.md` Session 2.)

4. **Takes screenshots** — `page.screenshot({ path, ... })` in `src/screenshot.ts`, fired once per recorded event so every step in the documentation has a visual.

`context.on("page", ...)` handles new tabs and popups by re-running setup on each new page.

## The recording loop

The injected script (`INJECTED_SCRIPT` constant in `src/recorder.ts`) is a self-contained IIFE that:

- Listens for `click` events in capture phase, builds a CSS selector for the target (prefers `#id`, then `data-testid`, then `name`, then `aria-label`, then a `tag:nth-of-type` path), and reports it.
- Listens for `input` events with a 500ms debounce so typing a 12-character word doesn't produce 12 events. Masks password fields as `********` before reporting.
- Wraps `history.pushState` / `history.replaceState` and listens for `popstate` / `hashchange` to catch SPA navigations that don't trigger a full page load.

Every reported event triggers a Node-side handler that waits 300ms for the DOM to settle, snaps a screenshot, and appends a `RecordedStep` to an in-memory array.

## Voice narration (`src/audio.ts`)

When you press Enter to start recording, FlowDoc spawns an `ffmpeg` subprocess in parallel with the click/screenshot recorder. The subprocess captures the system mic via macOS avfoundation and writes a single master file (`audio/recording.webm`). On Ctrl+C, the master is sliced into per-step files (`audio/step-NNN.webm`), each covering the time between two consecutive click timestamps.

A few details that matter:

- **Mic detection.** avfoundation's `-i :N` syntax requires a numeric device index. Picking `:0` blindly is a trap on multi-mic systems — index 0 is often a Continuity iPhone mic that produces choppy audio over Bluetooth. FlowDoc reads the macOS system-default input from `system_profiler SPAudioDataType`, looks it up in the avfoundation device list parsed from `ffmpeg -list_devices true -i ""`, and uses that index instead. Override with `--mic <name-or-index>`.

- **Encoder settings.** 48 kHz mono (matches mic native rate — requesting a different rate forces real-time resampling, which stutters under Playwright's CPU load), Opus codec in `voip` application mode at 96 kbps. `-thread_queue_size 4096` gives the avfoundation input thread a big enough buffer to survive CPU spikes.

- **Clean shutdown.** ffmpeg is stopped by writing `q\n` to its stdin (graceful — finalises the WebM container). SIGINT would also stop it but often leaves a corrupt header.

- **Slicing.** Each step's audio range is `[step.timestamp - audioStart, nextStep.timestamp - audioStart]`. ffmpeg re-encodes each slice (`-c:a libopus -b:a 96k`) rather than stream-copying, to sidestep keyframe-boundary issues. For typical 5–20 step flows this adds a second or two of post-processing.

Audio capture is on by default and gracefully degrades: if ffmpeg isn't on PATH the capture warns and continues silently; if the chosen mic can't be opened it falls back to no audio without aborting the capture.

## Why post-processing exists

Raw browser events ≠ workflow steps. A single user action like "click Login" can fire two click events (bubbling), then a navigation, plus sometimes a silent URL change. `src/postprocess.ts` runs a 4-pass pipeline:

1. **Dedup nested clicks** — adjacent clicks within 500ms collapse into the one with the shorter description (the inner element the user actually targeted).
2. **Merge click + navigation** — `click` followed by `navigation` within 2s becomes one logical "Open X" step. Also detects *silent* navigations: a click whose `url` differs from the next step's `url` is annotated as causing navigation even though no navigation event fired.
3. **Generate titles** — turns raw `"Clicked link 'Learn'"` into human `"Open 'Learn'"`, etc.
4. **Reindex** so the final array has clean sequential `index` values.

The output is `WorkflowStep[]` — the data structure every generator consumes.

## Generation

Four files come out of `flowdocs/<name>/`:

- `README.md` — `src/markdown.ts`. Per-step sections with embedded screenshot paths, action → result lines, collapsible technical details (selector, full URL).
- `flow.mmd` — `src/mermaid.ts`. Mermaid flowchart of page-to-page transitions.
- `notes-template.md` — `src/notes.ts`. Empty per-step sections for human annotation.
- `workflow-steps.json` — the processed steps verbatim. This is the *machine-readable* artifact that `flowdoc miro` reads.

## The HTML documentation site (`src/site.ts`)

The README.md is great for git diffs and for code reviewers, but for *consuming* a narrated flow it has two problems: the audio is hidden behind a 🎧 link instead of being directly playable, and the screenshots are inline at full size with no zoom. The HTML site fixes both.

`src/site.ts` generates a single self-contained `index.html` per flow folder. Layout: sticky TOC sidebar on the left, step sections on the right. Each step shows the title, the action line, the transcript blockquote (if transcribed), an `<audio controls>` element that plays inline, and the screenshot. Clicking a screenshot opens a fullscreen lightbox; the TOC highlights the current step as you scroll (one `IntersectionObserver`, no library).

Design choices worth flagging:

- **Single file, everything inline.** No external CSS, no external JS, no `node_modules`. The site is just the HTML file plus the existing `screenshots/` and `audio/` folders, all relative paths. Zip the flow folder and the documentation works anywhere.
- **No build step.** Plain string templates in Node. Adding React or a static-site generator would buy nothing here and balloon the dependency footprint.
- **Dark mode via `prefers-color-scheme`.** No toggle, no JS to manage state — CSS custom properties switch automatically with the OS.
- **Auto-regenerated.** Both `flowdoc capture` and `flowdoc transcribe` call `generateSite()` at the end, so the site is always fresh. `flowdoc site <folder>` exists for explicit regen.

## Transcription (`src/transcribe.ts` + `scripts/transcribe.py`)

`flowdoc transcribe <flow-folder>` walks each step's `narration.audioPath` and writes a Swedish text transcript into `narration.transcript`. Everything runs locally — no audio leaves the machine.

The architecture is a long-lived Python subprocess plus a thin Node wrapper:

- **Python worker (`scripts/transcribe.py`).** Loads `KBLab/kb-whisper-large` via the `transformers` `automatic-speech-recognition` pipeline once at startup (3 GB model, cached in `~/.cache/huggingface/`). Reads one audio path per line on stdin, writes one JSON object per line on stdout. The first line is `{"ready": true}` so the Node side knows when it can start sending paths. Each subsequent line is either `{"path": "...", "text": "..."}` or `{"path": "...", "error": "..."}`.

- **Node wrapper (`src/transcribe.ts`).** Spawns `python3 scripts/transcribe.py`, parses line-delimited JSON, manages a small in-memory queue so requests are processed sequentially (the model isn't parallel-safe). Exposes `transcribe(path) → Promise<string>`. Persists `workflow-steps.json` after each successful transcription, so Ctrl+C mid-run loses nothing already done.

- **Idempotency.** When a transcript is written, `narration.audioMtime` is set to `<mtimeMs>:<size>` of the audio file. On re-run, steps whose audio fingerprint matches the stored value are skipped. Re-record one step → only that one re-transcribes. Cheap, file-system-only, no hashing.

- **README regeneration.** After all transcriptions, `generateMarkdown()` is called again. It already handled the `narration.transcript` case during Phase 1 (renders as a `> blockquote` above the 🎧 audio link), so no extra code path was needed.

- **Miro pickup.** `stepsToGraph()` copies `step.narration?.transcript` onto each `WorkflowNode`. `shapeBody()` in `src/miro.ts` appends an italic second `<p>` line under the title when set. So re-running `flowdoc miro` after a transcribe pass surfaces the transcripts on the board automatically — no new flag, no separate command.

## The Miro export

`flowdoc miro` reads `workflow-steps.json`, runs it through `src/graph.ts` to convert into a `WorkflowGraph` (nodes + edges), then POSTs to Miro's REST v2 API:

- `POST /v2/boards/{id}/shapes` per node — Unikum-branded shape per step type (see below).
- `POST /v2/boards/{id}/connectors` per edge — elbowed lines with `endStrokeCap: arrow`, short captions like `click` / `type` / `navigate`.

Shapes must be created first so each connector can reference the returned Miro IDs. Calls are made sequentially with a soft rate-limit cushion: if `X-RateLimit-Remaining` drops below 10% of `X-RateLimit-Limit`, the next request waits a second before going out.

### Brand styling (Unikum)

`styleFor(node, isFork)` in `src/miro.ts` maps each `WorkflowNode` to a shape + fill + text color, following the Unikum kommunikationsguide:

| Step type | Miro shape | Fill | Text |
|---|---|---|---|
| Start step (`node.isStart`) | `circle` (180 × 180) | `#FFDB1C` yellow | dark |
| Fork point (2+ outgoing edges) | `rhombus` (280 × 200) | `#58B456` green | white |
| Click that landed on a page (`node.result` set) or pure navigation | `rectangle` (340 × 140) | `#C7DDF4` light blue | dark |
| Pure user action (click/input without nav) | `round_rectangle` (340 × 140) | `#0C69D2` blue | white |

Fork detection is computed at export time by tallying outgoing-edge counts per node — no schema change required, just a `Map<string, number>`. Borders are transparent (`borderOpacity: 0` with `borderWidth: 2`, because Miro rejects `borderWidth: 0` outright). Each shape's `data.content` is the title plus an optional italic `<p>` line for the transcript when present.

### Branching

Branching works by capturing two flows that share a starting URL and the first few clicks. `mergeGraphs()` in `src/graph.ts` walks both step arrays in lockstep, comparing `url + selector + action type`, stops at the first mismatch, and forks the branch at that point. `layoutGraph()` then assigns each node a position: depth from the start → x, which flow it belongs to → y (main = 0, branch1 = -260, branch2 = +260, …). The node where divergence happens automatically becomes a green diamond on the board because it ends up with two outgoing edges (one to the next main step, one to the branch's first divergent step).

Branches end independently in this version — no diamond convergence — and a branch that shares no prefix with main, is fully contained in main, or is empty is warned and skipped rather than fatal.

## The local web UI (`src/ui-server.ts` + `src/ui-page.ts`)

`flowdoc ui` is a thin HTTP+SSE wrapper around the existing CLI subcommands. The goal is discoverability for teammates who'd rather click than memorize flags; under the hood it spawns the same `node dist/index.js <subcommand>` processes the CLI runs.

- **`src/ui-server.ts`** — Node's built-in `http.createServer` binds to `127.0.0.1` on a random free port and prints the URL. Endpoints:
  - `GET /` → the UI HTML.
  - `GET /flowdocs/*` → serves files from the flowdocs tree, scoped to that directory; this is how the Site card opens a generated `index.html` directly.
  - `GET /api/flows` → list of flow folders with `{ name, stepCount, hasAudio, hasTranscripts }`.
  - `GET /api/mics` → avfoundation devices + the detected system default index.
  - `GET /api/status` → current session state and a replay of buffered output (refresh-safe).
  - `POST /api/start` → spawn a subcommand. Rejects 409 if a session is already running.
  - `POST /api/send-enter` → write `"\n"` to the active subprocess's stdin (capture's two-step start).
  - `POST /api/stop` → `kill("SIGINT")` to the active child.
  - `POST /api/miro-token` → in-memory `MIRO_ACCESS_TOKEN` override.
  - `GET /api/stream` → Server-Sent Events. Replays the session output buffer (cap 5 000 lines), then tails new lines as they arrive. ANSI escape codes are stripped before broadcast so the doctor's colored output doesn't show as raw text.
- **`src/ui-page.ts`** — a single HTML string (CSS + vanilla JS inline, no framework). One card per subcommand; a sticky log pane on the right; a status pill that ticks elapsed time during a run.

Single-session model — the server tracks at most one `Session` (the active child, its output buffer, started/exited state). New `/api/start` while busy returns 409 and the UI keeps the Run buttons disabled. Capture's two-button dance maps cleanly: Start spawns capture, Start recording POSTs `/api/send-enter`, Stop POSTs `/api/stop`. The Stop button only enables after Start recording has been clicked, so the empty-folder "I forgot to press Enter" trap can't happen.

## Capture shutdown durability

The capture process used to lose work occasionally when shut down: a hung `await` in the cleanup path, an EPIPE from a dead parent, or a duplicate signal could all leave `workflow-steps.json` unwritten. The current shutdown handler (`src/capture.ts`) hardens every path:

1. **`isShuttingDown` flag** — duplicate signals run the handler again but return immediately; no force-exit.
2. **30 s watchdog** — `setTimeout` with `unref()` calls `process.exit(0)` if anything past this point hangs.
3. **`safeLog` / `safeWarn`** — wrap `console.log` so EPIPE on a dead parent pipe doesn't throw.
4. **Save `workflow-steps.json` first** — written immediately after `recorder.waitForPending()` (which has its own 4 s timeout), before any audio or generator work. Raw events survive even if a later phase fails.
5. **Per-phase timeouts** — `waitForPending` 4 s, audio slicing 20 s, plus `audioRecorder.stop()` has its own 5 s timeout inside `audio.ts`.
6. **Fire-and-forget `browser.close()`** — Playwright's close sometimes stalls on IPC for opaque reasons; the await was the most common cause of "stuck at Closing browser…". We call it without awaiting; `process.exit(0)` in the outer `finally` kills the Chromium subprocess as a side effect.
7. **`try / finally` with `process.exit(0)`** — no matter what went wrong, the finally runs and the process exits cleanly.

The result: the UI shows `__DONE__ 0` within milliseconds of the last generator log line, regardless of what Chromium is doing.

## The Node ↔ browser dance

If you want one mental model: Playwright lets Node and browser JavaScript talk to each other across a process boundary. The browser script reports events; Node receives them, takes screenshots, and appends to an array. When the user presses Ctrl+C, Node processes that array and writes files. The browser is just the world the user acts in; Node is the observer taking notes.

No agents, no AI calls in the capture path. The whole thing is deterministic: same clicks → same output.

## Source map

| File | Role |
|---|---|
| `src/index.ts` | Commander CLI — `capture` / `transcribe` / `site` / `miro` / `doctor` / `ui` subcommands |
| `src/capture.ts` | Launches Playwright, waits for Enter, owns the recorder + audio lifecycle, hardened shutdown with watchdog + early JSON save |
| `src/ui-server.ts` | `flowdoc ui` HTTP server: localhost-only, SSE log stream, /api endpoints for flows/mics/status/control |
| `src/ui-page.ts` | Single-page UI as one HTML string: card per subcommand, sticky log pane |
| `src/recorder.ts` | The injected browser script + the Node-side event handler that turns events into `RecordedStep`s |
| `src/audio.ts` | ffmpeg subprocess wrapper: mic detection, recording, per-step slicing |
| `src/transcribe.ts` | Python subprocess wrapper for KBLab whisper transcription |
| `src/python.ts` | Shared Python resolution: `preferredPython` (venv first, then PATH), `hasModule` for dep checks |
| `src/doctor.ts` | `flowdoc doctor` — environment diagnostics, diagnose-only with copy-pasteable fix commands |
| `scripts/transcribe.py` | Long-lived Python worker that loads the whisper model and reads/writes JSON lines |
| `src/postprocess.ts` | 4-pass pipeline: `RecordedStep[]` → `WorkflowStep[]` |
| `src/markdown.ts` | Renders `README.md` from steps (including 🎧 audio links when narration is present) |
| `src/site.ts` | Renders the self-contained `index.html` documentation site (TOC, inline audio, lightbox) |
| `src/mermaid.ts` | Renders `flow.mmd` flowchart |
| `src/notes.ts` | Renders `notes-template.md` |
| `src/graph.ts` | `WorkflowStep[]` → `WorkflowGraph`, branch merging, layout |
| `src/miro.ts` | Pushes a `WorkflowGraph` to Miro via REST v2 |
| `src/screenshot.ts` | Wraps `page.screenshot()` + ensures the output dir exists |
| `src/types.ts` | Shared TypeScript interfaces |
