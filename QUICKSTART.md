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
source .venv/bin/activate
export MIRO_ACCESS_TOKEN='<your-miro-token>'
```

## Per flow

```bash
# 1. Capture — records clicks + audio narration
node dist/index.js capture --url <starting-url> --name <flow-name>
#   In browser: log in / dismiss popups / get to starting point
#   Press Enter in the terminal → audio + click recording start
#   Click through the workflow while narrating
#   Ctrl+C in the terminal to stop

# 2. Transcribe — Swedish whisper, runs locally
node dist/index.js transcribe flowdocs/<flow-name>

# 3. View the site (auto-generated, has inline audio + lightbox screenshots)
open flowdocs/<flow-name>/index.html

# 4. Push to Miro board (transcripts surface as a 2nd line per shape)
node dist/index.js miro --from flowdocs/<flow-name> --board "uXjVHOPXDss="
```

## Useful extras

```bash
# Regenerate the HTML site without re-capturing or re-transcribing
node dist/index.js site flowdocs/<flow-name>

# Capture without audio
node dist/index.js capture --url <url> --name <name> --no-audio

# Use a specific mic
node dist/index.js capture --url <url> --name <name> --mic Yeti

# Merge two captures into a branched Miro board (shared prefix → fork)
node dist/index.js miro --from flowdocs/<main> --branch flowdocs/<other> --board "<board-id>"
```
