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
  index.ts        — CLI entry point (commander setup, `capture` + `miro` subcommands)
  capture.ts      — Main capture loop: launches browser, waits for Enter, runs recorder, triggers generation
  recorder.ts     — Injects JS into pages, listens for click/input/navigation events, takes screenshots
  postprocess.ts  — 4-pass pipeline: dedup clicks → merge click+nav → generate titles → reindex
  markdown.ts     — Generates per-flow README.md with screenshots
  mermaid.ts      — Generates flow.mmd flowchart
  notes.ts        — Generates notes-template.md
  miro.ts         — Pushes a flow to Miro as native shapes + connectors via REST v2
  screenshot.ts   — Screenshot helpers (ensureDir, takeScreenshot)
  types.ts        — Shared interfaces (CaptureOptions, RecordedStep, WorkflowStep, BrowserEvent)
```

## Key conventions

- Output goes to `flowdocs/<name>/` by default (gitignored)
- `workflow-steps.json` is always emitted by `capture` (the `miro` subcommand reads it); `raw-events.json` is only emitted with `--debug`
- Recording always waits for Enter before starting (no flag needed)
- Post-processing detects both explicit navigations and silent URL changes (SPA-style)
- Passwords are masked as `********` in recordings
- Screenshots use `step-NNN.png` naming
- Miro export reads `MIRO_ACCESS_TOKEN` from env, creates shapes sequentially with a soft rate-limit cushion, never deletes existing board items
- Secrets policy: `.gitignore` blocks `.env`, `*.pem`, `*.key`, `secrets/` — keep tokens out of tracked files
