# FlowDoc — End-to-end commands

## One-time setup

```bash
# Node side
npm install
npm run build

# System deps
brew install ffmpeg

# Python env for transcription
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Per session (every new terminal)

```bash
cd /Users/jorgenselander/Projects/flowdoc-prototype
source .venv/bin/activate                 # so transcribe finds transformers + torch
export MIRO_ACCESS_TOKEN='<your-miro-token>'   # only if you'll push to Miro
```

## Verify your environment

```bash
node dist/index.js doctor
```

Prints a 9-row checklist (Node, build, ffmpeg, mic, Python, venv, transformers, Playwright, MIRO token). Green = ready; red = the command to fix it is printed below the row.

## Easiest path: the local web UI

```bash
node dist/index.js ui
```

Opens a browser tab with a card per subcommand (Doctor / Capture / Transcribe / Site / Miro). Use this if you don't want to remember CLI flags. The CLI commands below all map to buttons in the UI.

## CLI path — per flow

### 1. Capture clicks + voice narration

```bash
node dist/index.js capture --url <starting-url> --name <flow-name>
```

What happens:

1. The browser opens at `<starting-url>`.
2. Browse to your starting point — log in, dismiss popups, navigate around. **Nothing is recorded yet.**
3. Come back to the terminal and **press Enter**. At that moment both event recording and microphone recording start. The terminal prints `🎙 Audio recording started`.
4. Click through the workflow in the browser, **narrating out loud as you go**. Every click is a timestamp that becomes a split point in the audio.
5. Press **Ctrl+C** in the terminal to stop. The master audio is sliced into `audio/step-NNN.webm` per step. Screenshots, README, the HTML site, and `workflow-steps.json` are all written.

The audio mic is auto-detected from your macOS system default. Useful overrides:

```bash
node dist/index.js capture --url <url> --name <name> --mic Yeti   # pick by substring
node dist/index.js capture --url <url> --name <name> --mic 3      # pick by avfoundation index
node dist/index.js capture --url <url> --name <name> --no-audio   # skip audio entirely
```

### 2. Transcribe the narration (Swedish, local)

```bash
node dist/index.js transcribe flowdocs/<flow-name>
```

Runs `KBLab/kb-whisper-large` against each step's `.webm` slice. First run downloads the model (~3 GB, cached after that). Idempotent — re-running only re-transcribes steps whose audio has changed.

### 3. View the result

```bash
open flowdocs/<flow-name>/index.html
```

Self-contained HTML site with sticky TOC, inline `<audio controls>` per step, lightbox screenshots, transcripts as blockquotes.

### 4. Push to Miro

```bash
node dist/index.js miro --from flowdocs/<flow-name> --board "<board-id>"
```

Pushes branded shapes (yellow start circle, light-blue page rectangles, blue user-action rectangles, green diamond at any fork) with the transcript as a second line under each title.

## Useful extras

```bash
# Regenerate the HTML site without re-capturing or re-transcribing
node dist/index.js site flowdocs/<flow-name>

# Merge two captures into a branched Miro board (shared prefix → fork)
node dist/index.js miro \
  --from flowdocs/<main> \
  --branch flowdocs/<other> \
  --board "<board-id>"

# Three or more branches
node dist/index.js miro \
  --from flowdocs/<main> \
  --branch flowdocs/<other-1> \
  --branch flowdocs/<other-2> \
  --board "<board-id>"
```

## Stopping the UI server

If you started `flowdoc ui`, Ctrl+C in the terminal where you launched it stops the server. The browser tab keeps showing its last state but won't be functional after that.
