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

- `flowdoc capture` — record a browser workflow into a local folder
- `flowdoc miro` — push a captured flow to a Miro board

### `flowdoc capture`

```bash
npx flowdoc capture --url <starting-url> --name <flow-name> [--output <dir>] [--debug]
```

| Option | Required | Default | Description |
|---|---|---|---|
| `--url <url>` | Yes | | Starting URL to open |
| `--name <name>` | Yes | | Flow name (used as output folder name) |
| `--output <dir>` | No | `flowdocs` | Output directory |
| `--debug` | No | | Also write `raw-events.json` for debugging |

#### Workflow

1. The browser opens and navigates to `--url`
2. **Browse freely** — log in, dismiss popups, navigate to the starting point
3. **Press Enter** in the terminal to start recording
4. Perform the workflow you want to document
5. Press **Ctrl+C** to stop recording and generate docs

#### Output

For a flow named `my-flow`, output lands in `flowdocs/my-flow/`:

```
flowdocs/my-flow/
  README.md            # Step-by-step documentation with screenshots
  flow.mmd             # Mermaid flowchart of page navigations
  notes-template.md    # Per-step notes template for manual annotation
  workflow-steps.json  # Processed steps (consumed by `flowdoc miro`)
  screenshots/         # PNG screenshot per step
```

### `flowdoc miro`

Push a previously captured flow to a Miro board as native rounded-rectangle shapes connected by elbowed arrows. Each step becomes a shape; the start step is highlighted in green.

```bash
export MIRO_ACCESS_TOKEN='<your-miro-token>'
npx flowdoc miro --from flowdocs/<flow-name> --board "<board-id>"
```

| Option | Required | Description |
|---|---|---|
| `--from <flow-folder>` | Yes | Path to a captured flow folder containing `workflow-steps.json` |
| `--board <board-id>` | Yes | Miro board ID (the part between `/board/` and `/` in the board URL) |

The command also reads `MIRO_ACCESS_TOKEN` from the environment. Generate one in Miro under **Profile → Your apps → Create new app → Install on this team** (developer mode), then copy the token. Treat it like a password — the project's `.gitignore` blocks `.env` files so a local `.env` is a safe place to keep it.

Each run prints the IDs of every created shape and connector and the board URL at the end. Re-running creates a fresh set of shapes; existing items on the board are never touched or deleted.

## How it works

- **Recording** — An injected script listens for clicks, input changes, and URL changes (including `pushState`/`replaceState`) inside the browser. Each event triggers a screenshot.
- **Post-processing** — Raw events go through four passes:
  1. Deduplicate nested clicks (e.g. clicking a link inside a div)
  2. Merge click + navigation pairs, and detect silent URL changes (SPAs)
  3. Generate human-readable step titles
  4. Re-index steps
- **Generation** — Processed steps are rendered into Markdown, Mermaid, a notes template, and `workflow-steps.json` (the source of truth for the Miro export).
- **Miro export** — `workflow-steps.json` is read and pushed to Miro's REST v2 API as rounded-rectangle shapes plus elbowed connectors, sequenced sequentially with a soft rate-limit cushion.

## License

MIT
