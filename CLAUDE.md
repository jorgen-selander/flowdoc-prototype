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
  index.ts          — CLI entry point (commander setup, `capture` + `miro` subcommands)
  capture.ts        — Main capture loop: launches browser, waits for Enter, runs recorder + audio, triggers generation
  recorder.ts       — Injects JS into pages, listens for click/input/navigation events, takes screenshots
  audio.ts          — ffmpeg subprocess wrapper: records mic to audio/recording.webm, slices into per-step files
  postprocess.ts    — 4-pass pipeline: dedup clicks → merge click+nav → generate titles → reindex
  markdown.ts       — Generates per-flow README.md with screenshots + narration audio links / transcripts
  mermaid.ts        — Generates flow.mmd flowchart
  notes.ts          — Generates notes-template.md
  graph.ts          — WorkflowStep[] → WorkflowGraph conversion, branch merging (shared-prefix), layout
  miro.ts           — Pushes a WorkflowGraph to Miro as native shapes + connectors via REST v2
  screenshot.ts    — Screenshot helpers (ensureDir, takeScreenshot)
  types.ts          — Shared interfaces (CaptureOptions, RecordedStep, WorkflowStep, BrowserEvent, Narration, WorkflowNode, WorkflowEdge, WorkflowGraph)
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
- Audio narration is recorded live during `flowdoc capture`: ffmpeg (avfoundation on macOS) records the system mic from Enter until Ctrl+C. After recording stops, the master `audio/recording.webm` is sliced into `audio/step-NNN.webm` files using each step's first raw-event timestamp as a boundary. The `narration` field on each `WorkflowStep` points at its slice. Use `--no-audio` to opt out (e.g. when ffmpeg isn't installed). Transcription via KBLab whisper is a separate future command (`flowdoc transcribe`, not yet implemented).
- Secrets policy: `.gitignore` blocks `.env`, `*.pem`, `*.key`, `secrets/` — keep tokens out of tracked files
