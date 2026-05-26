# FlowDoc

Capture browser workflows and generate Markdown documentation with screenshots — and optionally push them to a Miro board as native shapes and connectors.

FlowDoc opens a real browser (Chromium via Playwright), records your clicks, inputs, and navigations, then generates a step-by-step README with screenshots, a Mermaid flowchart, and a notes template.

## Install

```bash
npm install
npm run build
```

Playwright will auto-install Chromium via the `postinstall` script.

## Usage

FlowDoc has two subcommands:

- `flowdoc capture` — record a browser workflow (with optional voice narration) into a local folder
- `flowdoc miro` — push a captured flow to a Miro board

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
  flow.mmd             # Mermaid flowchart of page navigations
  notes-template.md    # Per-step notes template for manual annotation
  workflow-steps.json  # Processed steps (consumed by `flowdoc miro`)
  screenshots/         # PNG screenshot per step
  audio/               # Master recording.webm + per-step step-NNN.webm slices (if audio was on)
```

### `flowdoc miro`

Push a previously captured flow to a Miro board as native rounded-rectangle shapes connected by elbowed arrows. Each step becomes a shape; the start step is highlighted in green. Multiple captured flows can be merged into a branched diagram by passing `--branch` one or more times.

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
