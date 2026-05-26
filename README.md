# FlowDoc

Capture browser workflows and generate Markdown documentation with screenshots.

FlowDoc opens a real browser (Chromium via Playwright), records your clicks, inputs, and navigations, then generates a step-by-step README with screenshots, a Mermaid flowchart, and a notes template.

## Install

```bash
npm install
npm run build
```

Playwright will auto-install Chromium via the `postinstall` script.

## Usage

```bash
npx flowdoc capture --url <starting-url> --name <flow-name> [--output <dir>] [--debug]
```

### Options

| Option | Required | Default | Description |
|---|---|---|---|
| `--url <url>` | Yes | | Starting URL to open |
| `--name <name>` | Yes | | Flow name (used as output folder name) |
| `--output <dir>` | No | `flowdocs` | Output directory |
| `--debug` | No | | Write `raw-events.json` and `workflow-steps.json` |

### Workflow

1. The browser opens and navigates to `--url`
2. **Browse freely** — log in, dismiss popups, navigate to the starting point
3. **Press Enter** in the terminal to start recording
4. Perform the workflow you want to document
5. Press **Ctrl+C** to stop recording and generate docs

### Output

For a flow named `my-flow`, output lands in `flowdocs/my-flow/`:

```
flowdocs/my-flow/
  README.md            # Step-by-step documentation with screenshots
  flow.mmd             # Mermaid flowchart of page navigations
  notes-template.md    # Per-step notes template for manual annotation
  screenshots/         # PNG screenshot per step
```

## How it works

- **Recording** — An injected script listens for clicks, input changes, and URL changes (including `pushState`/`replaceState`) inside the browser. Each event triggers a screenshot.
- **Post-processing** — Raw events go through four passes:
  1. Deduplicate nested clicks (e.g. clicking a link inside a div)
  2. Merge click + navigation pairs, and detect silent URL changes (SPAs)
  3. Generate human-readable step titles
  4. Re-index steps
- **Generation** — Processed steps are rendered into Markdown, Mermaid, and a notes template.

## License

MIT
