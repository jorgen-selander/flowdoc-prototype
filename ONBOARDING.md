# FlowDoc — Onboarding

FlowDoc records narrated browser workflows and turns them into a Miro board and a self-contained HTML site. This guide gets you from `git clone` to your first narrated workflow in about 15 minutes.

It's aimed at developers — comfortable with the terminal and managing a Python venv. For the daily cheat sheet once you're set up, see `QUICKSTART.md`. For "how it actually works under the hood", see `ARCHITECTURE.md`.

## Prerequisites

You'll need:

- **Node 18+** — [nodejs.org](https://nodejs.org). `nvm install 20` if you use nvm.
- **macOS** — currently the only tested platform (avfoundation mic capture is macOS-specific).
- **Homebrew** — [brew.sh](https://brew.sh) — to install ffmpeg quickly.
- **ffmpeg** — `brew install ffmpeg`. Used for mic recording and per-step audio slicing.
- **Python 3.10+** — comes with macOS or `brew install python`. Used only for the optional transcription step.
- **A Miro account** (optional) — only if you want to push captured flows to a Miro board. Free tier is fine.

## Setup walkthrough

```bash
# 1. Clone and install
git clone <repo-url>
cd flowdoc-prototype
npm install
npm run build

# 2. System deps
brew install ffmpeg

# 3. Python environment for transcription (optional but recommended)
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# (~700 MB download — torch is the big one.)

# 4. Miro token (optional, only if you'll push to a board)
cp .env.example .env
# Open .env in your editor and paste your token between the = and end of line.
# Then export it in your current shell (or add to your shell rc):
export MIRO_ACCESS_TOKEN='<paste-token-here>'
```

### Keeping the Miro token around between sessions

Three patterns, pick whichever fits your habits:

- **Per-session** (simplest): `export MIRO_ACCESS_TOKEN='...'` in each new terminal before running `flowdoc miro`.
- **Shell rc**: add the `export` line to `~/.zshrc` (or `~/.bashrc`). Persists across all sessions.
- **`.env` with `source`**: format your local `.env` as `export MIRO_ACCESS_TOKEN='...'`, then `source .env` whenever you want it loaded. Keeps the token out of your shell rc and out of the repo.

FlowDoc does not auto-load `.env` — there's no dotenv dependency. The file is a reference template.

### Where to get a Miro token

1. Sign in to Miro.
2. Go to [your apps](https://miro.com/app/settings/user-profile/apps).
3. Click **Create new app**, give it any name (e.g. "flowdoc local").
4. Click **Install on this team** and approve.
5. Copy the **access token** that appears. That's the value of `MIRO_ACCESS_TOKEN`.

You'll also need the **board ID** — the part between `/board/` and the next `/` in a board URL. Example: `https://miro.com/app/board/uXjVHOPXDss=/` → board id is `uXjVHOPXDss=`.

## Verify with `flowdoc doctor`

Once setup is done, run:

```bash
node dist/index.js doctor
```

You should see something like:

```
  ✓  Node version          v22.17.0
  ✓  Build output          dist/index.js exists
  ✓  ffmpeg                7.1.1
  ✓  System default mic    Fargo (avfoundation device 5)
  ✓  Python                python3 (3.13.3)
  ✓  Virtual env           .venv/bin/python (Python 3.13.3)
  ✓  transformers + torch  transformers 5.9.0, torch 2.12.0
  ✓  Playwright Chromium   installed
  ✓  MIRO_ACCESS_TOKEN     eyJtaX…hyc

  9 ok, 0 warnings, 0 failed.
```

What the statuses mean:

- **✓ (green)** — ready to go.
- **⚠ (yellow)** — non-fatal. Capture, transcribe, and site generation still work. Used for `MIRO_ACCESS_TOKEN` (only needed for `flowdoc miro`) and for the mic (a missing mic just means audio capture will be skipped).
- **✗ (red)** — blocks the core flow. The command after the value tells you exactly what to run.

Exit code is 0 if everything is ok or warning, 1 if any check failed. Useful for CI / pre-flight scripts.

## Your first capture

```bash
node dist/index.js capture --url https://example.com --name first-flow
```

The browser opens. Browse around, log in if needed, get to the starting point you want documented. Then come back to the terminal and **press Enter** — that's when both event recording and microphone recording start. Click through your workflow, narrating out loud as you go. **Ctrl+C** in the terminal when you're done.

Output lands in `flowdocs/first-flow/`. Open the HTML site to see what you got:

```bash
open flowdocs/first-flow/index.html
```

To transcribe the Swedish narration:

```bash
node dist/index.js transcribe flowdocs/first-flow
```

First run downloads the KBLab model (~3 GB) into `~/.cache/huggingface/`. Subsequent runs start in seconds.

To push to Miro:

```bash
node dist/index.js miro --from flowdocs/first-flow --board "<your-board-id>"
```

The four-command flow is documented compactly in `QUICKSTART.md`.

## Troubleshooting

- **First `flowdoc capture --audio` triggers a macOS mic prompt.** It's the OS asking the *terminal app* (iTerm, Terminal, etc.) for mic permission. Click Allow. One-time.
- **First `flowdoc transcribe` hangs on "Loading whisper model…".** That's the 3 GB download. Don't interrupt — it's cached after the first run.
- **Audio sounds choppy or distorted.** Run `flowdoc doctor` to confirm which mic is being picked. avfoundation's default device index isn't necessarily the same as your system default — `flowdoc capture` resolves that for you, but pass `--mic Yeti` (or any substring of your mic's name) to override if needed.
- **`zsh: command not found: flowdoc`.** There's no global install yet — run as `node dist/index.js <subcommand>`. Or alias it: `alias flowdoc="node $(pwd)/dist/index.js"`.
- **`pip install` fails with "externally managed environment".** Use the venv: `python3 -m venv .venv && source .venv/bin/activate` before `pip install`. The venv sidesteps PEP 668.
- **`flowdoc transcribe` can't find transformers despite `pip install`.** Make sure the venv is active in the shell that runs FlowDoc, OR confirm `.venv/bin/python` exists at the repo root — FlowDoc auto-prefers it when present.

## Reference links

- **KBLab whisper model** — [HuggingFace](https://huggingface.co/KBLab/kb-whisper-large) (downloaded automatically on first `transcribe`)
- **Miro REST API** — [developers.miro.com](https://developers.miro.com)
- **Playwright** — [playwright.dev](https://playwright.dev)
- **ffmpeg avfoundation guide** — [trac.ffmpeg.org/wiki/Capture/Desktop](https://trac.ffmpeg.org/wiki/Capture/Desktop)
