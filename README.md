# FlowDoc

Capture browser workflows and generate Markdown documentation with screenshots — and optionally push them to a Miro board as native shapes and connectors.

FlowDoc opens a real browser (Chromium via Playwright), records your clicks, inputs, and navigations, then generates a step-by-step README with screenshots, a Mermaid flowchart, and a notes template.

> **New teammate?** Start with [`ONBOARDING.md`](./ONBOARDING.md) — it walks through setup in ~15 minutes and verifies your environment with `flowdoc doctor`. Already set up? Jump to [`QUICKSTART.md`](./QUICKSTART.md) for the daily command sequence.

## Install

```bash
npm install
npm run build
```

Playwright will auto-install Chromium via the `postinstall` script.

## Usage

FlowDoc has six subcommands:

- `flowdoc capture` — record a browser workflow (with optional voice narration) into a local folder
- `flowdoc transcribe` — transcribe per-step audio to text using KBLab whisper (Swedish, local)
- `flowdoc site` — (re)generate a self-contained HTML documentation site for a flow
- `flowdoc miro` — push a captured flow to a Miro board
- `flowdoc doctor` — check that the local environment is set up (Node, ffmpeg, Python, venv, etc.)
- `flowdoc ui` — open a minimal local web UI in the browser to trigger all the commands above

### `flowdoc capture`

```bash
npx flowdoc capture --url <starting-url> --name <flow-name> [--output <dir>] [--debug] [--no-audio] [--mic <name-or-index>]
```

| Option | Required | Default | Description |
|---|---|---|---|
| `--url <url>` | Yes | | Starting URL to open |
| `--name <name>` | Yes | | Flow name (used as output folder name) |
| `--output <dir>` | No | `flowdocs` | Output directory |
| `--debug` | No | | Also write `raw-events.json` for debugging |
| `--no-audio` | No | | Skip microphone narration recording |
| `--mic <name-or-index>` | No | macOS system default | Pick a specific avfoundation audio input — a numeric index or a case-insensitive substring of the device name (e.g. `--mic Yeti`) |

#### Workflow

1. The browser opens and navigates to `--url`
2. **Browse freely** — log in, dismiss popups, navigate to the starting point
3. **Press Enter** in the terminal — both event recording and microphone recording start
4. Click through the workflow, **narrating out loud** as you go. Every click is a timestamp that becomes a split point in the audio.
5. Press **Ctrl+C** to stop. The master audio is sliced into per-step files based on click timestamps, screenshots and `workflow-steps.json` are written, and the README is generated.

#### Audio narration

Audio capture uses an `ffmpeg` subprocess reading the system mic via `avfoundation`. It is on by default; pass `--no-audio` to skip. Install ffmpeg with `brew install ffmpeg` if you don't already have it. On first use, macOS prompts your terminal app for microphone access.

**Mic selection.** On startup, FlowDoc reads your macOS system-default input device from `system_profiler` and matches it against the avfoundation device list. If detection fails it falls back to a built-in mic (`MacBook Pro Microphone`, `MacBook Air Microphone`, `Built-in Microphone`), and only then to device 0 — avoiding Continuity iPhone mics or other unreliable virtual devices that often live at index 0. To override the auto-detected device, pass `--mic <name-or-index>` (substring match, e.g. `--mic Yeti`). The chosen device is printed at startup:

```
🎙  Audio input: Fargo (avfoundation device 5)
```

Recording uses 48 kHz mono Opus in `voip` mode at 96 kbps — matching the mic's native sample rate (no resample stutter) and giving clear voice quality without inflated file sizes.

Each step gets its own `audio/step-NNN.webm` slice covering the time from when you clicked into that step until the next click. The README lists a 🎧 audio link per step.

#### Output

For a flow named `my-flow`, output lands in `flowdocs/my-flow/`:

```
flowdocs/my-flow/
  README.md            # Step-by-step documentation with screenshots + audio links
  index.html           # Self-contained HTML site (TOC sidebar, inline audio playback, lightbox screenshots)
  flow.mmd             # Mermaid flowchart of page navigations
  notes-template.md    # Per-step notes template for manual annotation
  workflow-steps.json  # Processed steps (consumed by `flowdoc miro`)
  screenshots/         # PNG screenshot per step
  audio/               # Master recording.webm + per-step step-NNN.webm slices (if audio was on)
```

### `flowdoc transcribe`

Transcribe the audio recorded by `flowdoc capture` to text using `KBLab/kb-whisper-large` running locally via the `transformers` library. Audio never leaves your machine.

```bash
npx flowdoc transcribe flowdocs/<flow-name>
```

| Argument | Description |
|---|---|
| `<flow-folder>` | Path to a captured flow folder containing `workflow-steps.json` and `audio/` |

#### Setup (one time)

You need Python 3 and the `transformers` + `torch` libraries. The recommended path is an isolated virtualenv at the project root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The first transcription downloads the KBLab model (~3 GB) into `~/.cache/huggingface/`. Subsequent runs start in a few seconds.

#### What it does

- Walks each step's `narration.audioPath`, sends it to a long-lived Python subprocess running the model, writes the result into `narration.transcript`.
- **Idempotent.** Each successful transcription stores the audio file's `<mtime>:<size>` in `narration.audioMtime`. On re-run, steps whose fingerprint matches are skipped. Re-record one step in a fresh capture run → only that one re-transcribes.
- Regenerates `README.md` with the transcripts as blockquotes above the 🎧 audio links.
- The next `flowdoc miro` run automatically surfaces each transcript as a second italic line under the shape title on the board.

### `flowdoc site`

(Re)generate a self-contained HTML documentation site for an existing flow folder. The site is also auto-emitted by `flowdoc capture` and re-emitted by `flowdoc transcribe`, so you usually don't need to run this directly — only when you want to regenerate without re-capturing or re-transcribing.

```bash
npx flowdoc site flowdocs/<flow-name>
open flowdocs/<flow-name>/index.html
```

| Argument | Description |
|---|---|
| `<flow-folder>` | Path to a captured flow folder containing `workflow-steps.json` |

What the site has:

- Two-column layout with a sticky TOC sidebar on the left (scroll-spy highlights the current step as you scroll).
- One section per step: number badge → title → action line → transcript blockquote (if transcribed) → inline `<audio controls>` (plays directly in the page) → clickable screenshot.
- Click any screenshot to open a fullscreen lightbox; Esc or click outside closes it.
- Dark mode kicks in automatically when the OS is set to dark (no toggle).
- Everything inline — single HTML file, no external CSS/JS. The flow folder is portable: zip and send.

### `flowdoc doctor`

Print a status checklist of the local environment — Node, build output, ffmpeg, system mic, Python, virtual env, transformers + torch, Playwright Chromium, MIRO token. Diagnose only — never installs anything. Exit 0 if no failures, 1 otherwise.

```bash
node dist/index.js doctor
```

Red rows include the exact command to fix the problem. Recommended first command for any new teammate; see `ONBOARDING.md` for the full setup walkthrough.

### `flowdoc ui`

Open a minimal local web UI in the browser that wraps every other subcommand in a card with the right inputs and a Run button. Live output streams into a log pane via Server-Sent Events.

```bash
node dist/index.js ui
```

What you get:

- One card per subcommand (Doctor, Capture, Transcribe, Site, Miro). Inputs map 1:1 to CLI flags.
- Capture's two-step flow surfaces as two buttons: **Start** opens the browser, **Start recording (Enter)** begins capturing clicks + audio, **Stop & save** finalises and writes files. Stop is disabled until recording has actually begun, so you can't accidentally throw away the session.
- Mic dropdown auto-populated from your avfoundation devices, with the macOS system default pre-selected.
- Branch multi-select on the Miro card — Cmd-click to include additional captured flows; each becomes a separate `--branch` argument under the hood.
- In-memory `MIRO_ACCESS_TOKEN` override field for one-off pushes without exporting the var.
- `flowdocs/*` is served at `/flowdocs/*` so the generated `index.html` site can be opened directly from the Site card after generation.

Server binds to `127.0.0.1` on a random port. Ctrl+C in the launching terminal stops it.

### `flowdoc miro`

Push a previously captured flow to a Miro board as native shapes connected by elbowed arrows, using the Unikum brand palette and flowchart-symbol language:

| Step type | Symbol | Fill |
|---|---|---|
| Start | Yellow circle | `#FFDB1C` |
| Pure user action (click, input) | Blue rounded rectangle | `#0C69D2` |
| Click that landed on a page / pure navigation | Light blue rectangle | `#C7DDF4` |
| Fork point (any node with 2+ outgoing edges, auto-detected from `--branch`) | Green diamond | `#58B456` |

Multiple captured flows can be merged into a branched diagram by passing `--branch` one or more times.

```bash
export MIRO_ACCESS_TOKEN='<your-miro-token>'
npx flowdoc miro --from flowdocs/<main-flow> [--branch flowdocs/<other-flow>]... --board "<board-id>"
```

| Option | Required | Description |
|---|---|---|
| `--from <flow-folder>` | Yes | Main flow folder containing `workflow-steps.json` |
| `--branch <flow-folder>` | No | Alternative branch flow folder. Repeatable — pass `--branch` multiple times to add multiple branches. |
| `--board <board-id>` | Yes | Miro board ID (the part between `/board/` and `/` in the board URL) |

The command also reads `MIRO_ACCESS_TOKEN` from the environment. Generate one in Miro under **Profile → Your apps → Create new app → Install on this team** (developer mode), then copy the token. Treat it like a password — the project's `.gitignore` blocks `.env` files so a local `.env` is a safe place to keep it.

Each run prints the IDs of every created shape and connector and the board URL at the end. Re-running creates a fresh set of shapes; existing items on the board are never touched or deleted.

#### Branching workflows

To document a workflow with two (or more) clickable options at a decision point, capture each path as its own flow — sharing the same starting URL and the same initial actions — then export them together:

```bash
# Capture path A
flowdoc capture --url https://app/start --name signup-card
# (log in → choose plan → click "Card" → fill card → done)

# Capture path B with the same prefix, divergent ending
flowdoc capture --url https://app/start --name signup-bank
# (log in → choose plan → click "Bank" → fill account → done)

# Merge and export
flowdoc miro --from flowdocs/signup-card --branch flowdocs/signup-bank --board "<board-id>"
```

The exporter walks both flows in parallel from step 0 and shares any prefix steps that match on `url + selector + action type`. At the first divergent step, it forks: the main path stays on the centre lane (y = 0), branches stack outward at y = ±260, ±520, etc. Branches do not re-converge in this version — each branch ends independently. If a branch shares no prefix with the main flow, is fully contained in it, or is empty, a warning is logged and the branch is skipped.

## How it works

- **Recording** — An injected script listens for clicks, input changes, and URL changes (including `pushState`/`replaceState`) inside the browser. Each event triggers a screenshot.
- **Audio** — When audio is on, an `ffmpeg` subprocess starts the moment Enter is pressed and records the system mic to `audio/recording.webm`. Each click event's timestamp marks a split point. On shutdown the master is sliced into `audio/step-NNN.webm` per step.
- **Post-processing** — Raw events go through four passes:
  1. Deduplicate nested clicks (e.g. clicking a link inside a div)
  2. Merge click + navigation pairs, and detect silent URL changes (SPAs)
  3. Generate human-readable step titles
  4. Re-index steps
- **Generation** — Processed steps are rendered into Markdown (with 🎧 audio links per step when narration is present), Mermaid, a notes template, and `workflow-steps.json` (the source of truth for the Miro export).
- **Miro export** — `workflow-steps.json` (and any branch flows) are converted to a graph (`WorkflowNode` + `WorkflowEdge`), prefix-merged when branches are supplied, laid out with depth → x and lane → y, and pushed to Miro's REST v2 API as rounded-rectangle shapes plus elbowed connectors, sequenced sequentially with a soft rate-limit cushion.

## License

MIT
