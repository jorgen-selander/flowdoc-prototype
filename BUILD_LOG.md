# FlowDoc Build Log

A chronological record of how FlowDoc was built in a single evening, pair-programming with Claude Code (Opus 4.6). Written for an article about the experience.

---

## Session 1: Planning (Plan Mode)

**Time:** ~02:40
**Duration:** ~15 min
**Mode:** Plan mode (no edits allowed)

Started with a high-level brief:

> Build a Node.js CLI tool called FlowDoc CLI. Goal: Capture a browser workflow using Playwright and generate Markdown documentation with screenshots. Target user: a PM, QA person, or AI-assisted builder who wants to document a product flow quickly.

Claude asked clarifying questions about scope. Key decisions made:
- TypeScript with Commander for CLI
- Playwright (Chromium) for browser automation
- Output: Markdown README with embedded screenshots
- No AI, no web UI, no database — just a CLI tool

**ChatGPT cross-check:** Pasted the plan into ChatGPT for a second opinion. It flagged that screenshots could expose login screens. This led to adding the `--record-from-now` flag to the plan — open browser first, let user log in, then press Enter to start recording.

The plan covered 9 source files, the injected browser script, selector generation strategy, and password masking.

---

## Session 2: Initial Implementation

**Time:** ~02:55
**Duration:** ~40 min
**Commit:** `ed4b6bd` — Initial implementation of FlowDoc CLI

Claude generated all 9 source files in one pass:
- `package.json`, `tsconfig.json`, `.gitignore`
- `src/types.ts`, `src/index.ts`, `src/capture.ts`
- `src/recorder.ts` (the big one — injected browser script + event handling)
- `src/screenshot.ts`, `src/markdown.ts`

Built clean on first try. The CLI parsed correctly.

**Git setup hiccup:** The repo was inside a home-directory-level `.git` (not project-level). Had to initialize git properly in the project directory. No `gh` CLI available and no sudo, so I created the GitHub repo manually at github.com/budkorpenning/flowdoc, then Claude added the remote and pushed.

### First test: mantus.ai

Ran `node dist/index.js capture --url https://mantus.ai --name mantus-flow`. Browser opened... but no clicks were recorded. Only the start step appeared.

**Root cause:** `addInitScript` only runs on *future* navigations. Since `setupPage` was called after `page.goto`, the injected script never ran on the current page.

**Fix:** Added `await page.evaluate(INJECTED_SCRIPT)` after `addInitScript` to inject into the already-loaded page.

**Commit:** `f8a6a9f` — Fix injected script not running on already-loaded page

### Second test: mantus.ai (again)

This time it worked. 13 steps captured with screenshots, clicks detected, navigation tracked. The raw output was functional but read like an event log — every click was a separate step from its navigation.

---

## Session 3: Post-Processing (v0.2)

**Time:** ~03:35
**Duration:** ~25 min
**Commit:** `64ecea9` — Add post-processing layer for clean workflow documentation

Looking at the mantus.ai output, the problems were clear:
- Click and navigation events were separate steps (should be merged)
- Nested clicks from DOM bubbling created duplicates
- Raw selectors shown instead of human-readable titles
- No flowchart or notes template

Designed a 4-pass post-processing pipeline in `src/postprocess.ts`:
1. **Dedup nested clicks** — when two clicks fire <500ms apart, keep the one with shorter text (inner element)
2. **Merge click+navigation** — if click is followed by navigation within 2s, merge into one step
3. **Generate titles** — `Open "Learn"`, `Enter "username"`, `Navigate to Guides`
4. **Re-index** — clean sequential numbering

Also added:
- `src/mermaid.ts` — generates `flow.mmd` flowchart from page transitions
- `src/notes.ts` — generates `notes-template.md` for manual annotation
- `--debug` flag for `raw-events.json` + `workflow-steps.json` output
- Rewrote `src/markdown.ts` with path breadcrumbs, collapsible technical details

### Testing on demo.unikum.net

Ran the tool against a real enterprise app (Unikum). 12 workflow steps generated from 14 raw events — the click+nav merge worked. Output included login steps, form inputs with masked passwords, and page navigation.

**Small fix:** `pageName()` was showing "Login.jsp" instead of "Login".

**Commit:** `23cd133` — Strip file extensions from pageName() output

---

## Session 4: v0.3 — Always Wait for Enter + Silent URL Detection

**Time:** ~05:55
**Duration:** ~15 min
**Commit:** `694ba56` — Always wait for Enter before recording and detect silent URL changes

Two issues surfaced from the Unikum capture:

### Issue 1: Recording started at login

The `--record-from-now` flag existed but wasn't used in the test command. Login steps were captured. User observation: "If record-from-now is solved with Enter, then why did it start recording at login?" — because the flag wasn't passed.

**Decision:** Make "wait for Enter" the *default* behavior. Remove the flag entirely. Recording never starts immediately — you always browse freely first, then press Enter to begin.

### Issue 2: Silent URL changes missed

Unikum is an SPA-like app. Clicking "explore" on `start.html` navigated to `group.html`, but no `navigation` event fired (no `pushState`, no `popstate`). The postprocessor only merged clicks with explicit navigation events, so this transition was invisible.

**Fix:** In `mergeClickNav()`, after checking for explicit click+navigation pairs, also check if the *next step* has a different URL pathname. If so, annotate the click with a navigation result without consuming the next step. Simplified `generateTitles()` to check `step.result` presence rather than raw step count.

Files changed: `src/types.ts`, `src/index.ts`, `src/capture.ts`, `src/postprocess.ts`.

---

## Session 5: Documentation

**Time:** ~06:30
**Duration:** ~10 min
**Commit:** `35f6516` — Add project README and CLAUDE.md

Before switching to another computer, created:
- **README.md** — usage guide with options table, workflow description, output structure, and how-it-works overview
- **CLAUDE.md** — project context file so Claude Code has immediate understanding on any machine

---

## Session 6: Miro Export (v0.4)

**Time:** ~07:30 (next morning, new machine)
**Duration:** ~30 min
**Commits:** `d2e8fb7` — Add `flowdoc miro` subcommand, `ba8cf77` — Expand .gitignore

Wanted to take a captured flow and visualise it on a Miro board as native, editable shapes — not just a static Markdown export. Token + board ID confirmed working against `GET /v2/boards/{board_id}` before any code was written.

### Planning (Plan Mode)

Brief: a new `flowdoc miro --from <flow-folder> --board <board-id>` subcommand that reads `workflow-steps.json`, POSTs rounded-rectangle shapes (one per step) at `x = i*450, y = 0`, then POSTs elbowed connectors between adjacent shapes. No screenshots, no OAuth, no two-way sync.

Claude (Opus 4.7) explored the codebase via subagents, surfaced four open questions, and proposed defaults. User confirmed:

1. **`workflow-steps.json` is always emitted** by `capture.ts` (not gated on `--debug` any more — `raw-events.json` stays debug-gated). Means any captured flow is miro-ready without re-capturing.
2. **The "start" step becomes a shape** at the leftmost position so the board reads top-to-bottom as an entry point + actions.
3. **Connectors are elbowed**, with a short action-type caption (`click`, `type`, `navigate`) derived from `rawSteps[0].action`.

### Implementation

Three files touched:
- **`src/capture.ts`** — moved `workflow-steps.json` write out of the `--debug` block.
- **`src/miro.ts`** (new) — `generateMiro()` reads steps, POSTs shapes sequentially (collecting IDs), then POSTs connectors using `startItem.id`/`endItem.id`. Uses Node 22's global `fetch`, no new deps. Soft rate-limit cushion when `X-RateLimit-Remaining` drops below 10% of the limit. Errors surface Miro's response body.
- **`src/index.ts`** — registered the `miro` subcommand alongside `capture` with token + file-existence validation.

### First test on demo.unikum.net

Captured 5 steps, ran the export, opened the board. Shapes + connectors appeared at the right positions, captions read `click` between every step — but the rounded rectangles themselves were invisible. The text labels just floated.

**Root cause:** the shape body didn't include an explicit `style` block, so Miro applied defaults. The default 2px border vanishes at the zoom level Miro opens with after a fresh board push.

**Fix:** added explicit `style` to shapes — 4px borders (green `#4caf50` for the start step, blue `#2d9bf0` for the rest), white fill, 20px Open Sans, vertically centered. Also styled the connectors: 2px dark line, 14px caption font. Same commit (`d2e8fb7`).

User reaction after re-running: *"Dear Lord, this is awesome!"*

### Secrets hygiene

Followed up with a `.gitignore` pass to defensively block secrets before any token landed in a tracked file. Added patterns for `.env` / `.env.*` (with `!.env.example` carve-out), private keys (`*.pem`, `*.key`, `*.p12`, `*.pfx`), `secrets/` directories, and OS junk (`.DS_Store`, `Thumbs.db`). Nothing was actually tracked — purely preventative.

**Commit:** `ba8cf77` — Expand .gitignore to defensively block secrets

### What surprised me

- Miro's v2 API renames from v1 are real and undocumented in older Stack Overflow answers: `startWidget` → `startItem`, `lineStartType` → `style.startStrokeCap`. The plan-mode agent caught this by reading the current docs instead of going from memory.
- The "shapes look invisible" iteration was 30 seconds of work because the layout/positioning code was already correct — only the `style` block was missing. A clean separation between layout and presentation paid off.

---

## Session 7: Branching workflows (v0.5)

**Time:** ~08:00
**Duration:** ~40 min
**Commit:** `0ae6b4c` — Add branching support to `flowdoc miro` via a graph model

After getting the linear Miro export working, the next natural question came up almost immediately: *"Some times there might be two clickable options I want to get into the same workflow. Is this possible and how to do it?"*

The current data model (`WorkflowStep[]` ordered by index) couldn't represent it — each step had exactly one predecessor and one successor.

### Cross-checking with ChatGPT

User pasted ChatGPT's full architectural proposal: refactor to a `WorkflowGraph` (nodes + edges), make the linear flow just a degenerate case of a graph, and ship in three phases — manual graph file first, then multi-capture merge, then branch-capture-during-recording. The user said *"Only consider what you find relevant, you know the code best."*

Most of ChatGPT's reasoning was correct. Pushed back on three things, knowing the actual codebase:

1. **YAML** for the graph file — there's no YAML parser in the deps. JSON throughout, matches `workflow-steps.json`.
2. **Manual graph file as the FIRST user-facing step** — the user had already picked "two captures + auto-merge" as their preferred UX. Hand-authoring a graph JSON is friction they didn't ask for. Ship the merge directly; the graph file is internal-only for now.
3. **"Detect shared URLs/screens and collapse them"** — that's the diamond/suffix case, which the user explicitly deferred. v0.5 is Y-fork only.

Also calibrated the branch lane spacing from ChatGPT's `±200` to `±260` — shape height 140 plus 4px borders needed more breathing room.

### Architecture

Three concepts in `src/graph.ts`:

- `stepsToGraph(steps, flowName)` — wraps a captured flow in a `WorkflowGraph`. Each step becomes a node `${flowName}:${index}`; consecutive pairs become edges labelled with the action type (`click`/`type`/`navigate`).
- `mergeGraphs(main, mainSteps, branches[])` — for each branch, walks both step arrays in lockstep until `url + selector + action type` stop matching. Drops the branch's duplicate prefix nodes, adds a fork edge from `main:i-1 → branch:i`, appends the rest. Warns and skips for empty branches, identical branches, and branches with no shared prefix.
- `layoutGraph(graph)` — BFS depth from the start node → `x = depth * 450`. Lane assignment: `main = 0`, branches alternate outward (`branch1 = -260`, `branch2 = +260`, `branch3 = -520`, …).

`src/miro.ts` was rewritten to consume `WorkflowGraph` instead of `WorkflowStep[]`. The HTTP/styling code (rounded rectangles, green-vs-blue borders, elbowed connectors, rate-limit cushion) is untouched — only the iteration loop changed from "for each step" to "for each node, then for each edge". `src/index.ts` got a `collect()` reducer and a repeatable `--branch <folder>` option.

### Verification before the live test

Wrote a small offline self-test using `node -e` to feed synthetic main + branch step arrays through `stepsToGraph → mergeGraphs → layoutGraph` and print the resulting nodes and edges. Confirmed:
- Linear backward-compat (no branches → identical layout to v0.4).
- Y-fork at the correct depth, branched lane at y = -260.
- Three-branch lane assignment (-260, +260, -520).
- Edge cases warn-and-skip without aborting.

This caught a bug-that-wasn't (the depth assignment was correct on first try) but saved a round-trip to the real Miro API.

### Live test

User captured two flows on the same Unikum demo site sharing a login prefix, then ran:

```
flowdoc miro --from flowdocs/fork-A --branch flowdocs/fork-B --board "..."
```

Worked cleanly. *"Great! Update docs, commit and push"*.

### What surprised me

- The `WorkflowGraph` refactor was almost free because the Miro export was already a pure function over an ordered structure. Swapping `WorkflowStep[]` for a graph that exposes `node.x` and `node.y` per node was a couple of method-signature changes; the styling/HTTP code didn't move.
- The offline self-test via `node -e` was a 5-minute investment that bought certainty before any real API call. For graph-shape logic with multiple edge cases, this was more useful than a unit test framework would have been.

---

## Session 8: Live audio narration (v0.6a — pivoted)

**Time:** ~08:45
**Duration:** ~50 min (incl. one wrong turn)
**Commit:** `e981446` — Record per-step audio narration live during `flowdoc capture`

The goal: make voice the documentation primitive. Each step in the README gets a 🎧 audio link. Later (Phase 2, deferred) a Whisper transcription pass folds the transcript inline.

### First design (wrong): separate slide-deck pass

The first plan was a separate `flowdoc narrate <flow-folder>` command that opens a Chromium slide-deck UI — one screenshot per slide with Record/Stop/Prev/Next buttons. ChatGPT was consulted and suggested splitting transcription out into a separate Phase 2; that part was right and is still the plan. The slide-deck design was implemented end-to-end: HTTP server, MediaRecorder, `getUserMedia`, base64 round-trip, audio file writes, README regeneration. Build was clean.

Then the user pushed back on the underlying assumption:

> "Driving the UI and explaining out loud at the same time is hard." This assumption is wrong, this is what people like me do all the time.

Correct. PMs / designers / anyone who's done a Loom walkthrough does exactly this. The cognitive-load argument was a generalised assumption from a non-typical user. The slide-deck pass became friction, not a feature.

### Second design (shipped): live audio during capture

Pivoted to: when you press Enter to start `flowdoc capture`, audio recording also starts. Each click is a timestamp that becomes a split point in the master audio. On Ctrl+C, the master is sliced into per-step files.

Technical call: do the audio in Node via an **ffmpeg subprocess**, not in the browser:
- Survives page navigation (browser-side MediaRecorder dies on navigate; the captured site might reload several times).
- No `getUserMedia` permission prompt on the captured site itself.
- One master file, sliced deterministically at the end with `ffmpeg -ss/-to -c:a libopus`.
- ffmpeg is already the Phase 2 transcription dep, so adding it now is no new surface.

Implementation:
- `src/audio.ts` (new) — `AudioRecorder` class wraps the ffmpeg subprocess. `start()` spawns `ffmpeg -f avfoundation -i ":0" -c:a libopus`, sends `q\n` on stdin to stop cleanly, then `sliceByRanges()` cuts the master into per-step `.webm` files.
- `src/capture.ts` — checks ffmpeg at startup, starts the recorder when Enter is pressed, stops it on shutdown, attaches `narration` (audioPath, durationMs, recordedAt) to each WorkflowStep before generation.
- `src/types.ts` — added `Narration` interface and `audio: boolean` to `CaptureOptions`.
- `src/markdown.ts` — when a step has `narration`, render a `🎧 [Audio narration](path) · 4.2s` line above the screenshot.
- Deleted `src/narrate.ts` + `src/narration-ui.ts` (the slide-deck stuff from the first design).

### What surprised me

- The pivot deleted ~400 lines of working code 30 minutes after writing it. That's the right move when the design is wrong, but it's a sharp reminder that "works" isn't the same as "right". Plan-mode confidence is no substitute for the user pushing back on a load-bearing assumption.
- ffmpeg's `q\n`-on-stdin stop is much cleaner than `SIGINT` for getting a valid finalised file. SIGINT often leaves a corrupt header.
- Slicing with `-c:a libopus` (re-encode) is only fractionally slower than `-c copy` for short clips and avoids keyframe-boundary surprises. Sticking with re-encode for reliability.

---

## Session 9: Mic detection (v0.6a fix-up)

**Time:** ~09:50
**Duration:** ~25 min
**Commits:** `2016d07` — Auto-detect macOS default mic + add `--mic` override; `820ca24` — Document mic auto-detect

First narrated capture on real hardware sounded clearly choppy and distorted. Listening more carefully, the audio was glitchy in a way that QuickTime recording from the same machine wasn't. The first hypothesis was a sample-rate issue (16 kHz vs the mic's native 48 kHz) plus a too-small ffmpeg thread queue. Bumped to 48 kHz, added `-thread_queue_size 4096`, switched Opus to `voip` mode at 96 kbps. Still choppy.

### The real cause

Asked the user to run `ffmpeg -f avfoundation -list_devices true -i ""`. The list was revealing:

```
[0] Jörgen's iPhone Microphone
[1] Microsoft Teams Audio
[2] Yeti Stereo Microphone
[3] MacBook Pro Microphone
[4] External Microphone
[5] Fargo
[6] Display Audio
```

My ffmpeg command used `-i :0`, which in avfoundation's `video_index:audio_index` syntax means "audio device index 0" — the **iPhone Microphone** over Continuity. That's a wireless mic with all the latency and packet-loss issues you'd expect. The user's actual default input (set in System Settings) was *Fargo*, an audio interface at index 5.

So the chop wasn't a buffer or sample-rate problem at all — it was that we were recording from the wrong device entirely. `:0` is a footgun on any multi-mic Mac.

### Fix: detect the system default automatically

`system_profiler SPAudioDataType` (plain-text output) lists each audio device and marks the one with `Default Input Device: Yes`. Parsed that, then matched the device name (case-insensitive, with substring tolerance for differences like `"Jörgen's iPhone"` vs the avfoundation rendering) against the avfoundation device list to get its index. Wired that into the ffmpeg command instead of the hardcoded `:0`.

Also added a `--mic <name-or-index>` override: numeric index for precision, or a case-insensitive substring (`--mic Yeti`) for convenience. Validation against the device list, with the available devices listed in the error message when nothing matches.

Heuristic fallback if `system_profiler` parsing fails: prefer `MacBook Pro Microphone` / `MacBook Air Microphone` / `Built-in Microphone` over device 0. Only falls through to `:0` as last resort with a warning.

### Verification

Hooked the new functions up and tested with a tiny `node -e` self-test against the live system, before re-recording:

```
--- system default input ---
  Fargo
--- resolved (no override) ---
  5 · Fargo
```

Then a full capture run with audio on. User confirmed it sounded clean.

### What surprised me

- The "audio is choppy" symptom looked like a buffer / sample-rate problem (the standard avfoundation chop pattern), and my first round of fixes targeted exactly that. They were *correct fixes for a real but different problem* — necessary later, but not the actual cause.
- The simplest diagnostic — "show me what devices avfoundation actually sees" — would have led to the answer in 30 seconds. Worth reaching for hardware listings earlier when symptoms involve hardware.
- `system_profiler` plain-text output is awful to parse but stable and dependency-free. The `-json` variant is structurally easier but turned out to be inconsistent across macOS versions, and the text format hasn't changed in years.

---

## Session 10: Local whisper transcription (v0.6b)

**Time:** ~10:30
**Duration:** ~45 min
**Commit:** `f2052a8` — Add `flowdoc transcribe` — local Swedish whisper via KBLab

Phase 2 of the narration plan: take the per-step audio files produced by `flowdoc capture` and turn them into text using `KBLab/kb-whisper-large` running locally via the `transformers` library. No cloud APIs, no audio leaving the machine.

### Architecture

Long-lived Python subprocess + thin Node wrapper, talking over a JSON-line stdin/stdout protocol:

- `scripts/transcribe.py` — loads the model once (`pipeline("automatic-speech-recognition", model="KBLab/kb-whisper-large")`), prints `{"ready": true}`, then reads one audio path per line on stdin and writes `{"path": ..., "text": ...}` or `{"path": ..., "error": ...}` on stdout. ~50 lines.
- `src/transcribe.ts` — spawns the Python process, parses the line-delimited JSON, exposes `transcribe(audioPath) → Promise<string>` with a small in-memory queue so requests run sequentially. ~200 lines.

Idempotency via a `narration.audioMtime` fingerprint (`<mtimeMs>:<size>`). Each successful transcription stamps the fingerprint of the audio file it consumed; re-runs skip steps whose audio hasn't changed. Re-record a single step in a fresh `flowdoc capture` run → only that one re-transcribes. Cheap, no hashing, no separate DB.

### The graceful inheritance from Phase 1

When I wrote `markdown.ts`'s `appendNarration()` back during Phase 1 audio, I already coded the transcript blockquote case (it was unreachable until Phase 2 landed). Same with `WorkflowNode.transcript` being optional. So Phase 2 was almost entirely *additive*: one new file each on the Python and Node sides, three small touch-ups (`graph.ts` to copy the transcript onto nodes, `miro.ts` to render it as a second italic line in shapes, `types.ts` to add `audioMtime`), and one new subcommand registration. The README and Miro outputs picked up transcripts with zero code changes in the generators themselves.

### Live test

User created a venv, `pip install -r requirements.txt` (transformers 5.9.0, torch 2.12.0, total ~700 MB download), ran:

```
node dist/index.js transcribe flowdocs/audio-test4
Loading whisper model (first run downloads ~3 GB from HuggingFace)...
Model ready. Transcribing 9 step(s)...
  [0] step-000 ✓ "Då är vi på startsidan för Astrid Frisk och här väljer vi kl…"
  [1] step-001 ✓ "När vi har kommit till kunskaper får vi upp en ruta med dire…"
  …
  [8] step-008 ✓ "Då är vi klara."
Done. README.md regenerated with transcripts inline.
```

Nine fluid Swedish sentences from a single demo capture. KBLab's Swedish-tuned whisper handled student names, technical UI terms ("Ämnesöversikt", "godtagbara"), and a closing "Då är vi klara" cleanly.

### What surprised me

- The "load model once, stream paths in" architecture saves 10–15 s of model-load latency *per call*. For a 9-step flow with sub-2-second transcriptions that's the difference between 20 s total and 2 minutes.
- Phase 1's "write the not-yet-reachable branch anyway" calls (`appendNarration`'s transcript path, `WorkflowNode.transcript`) felt mildly speculative at the time. They paid off completely in Phase 2: zero touch-up needed in the generators. The split-in-two phasing only worked cleanly *because* Phase 1 already shaped data for Phase 2.
- transformers 5.9 changed the pipeline kwargs slightly from older docs — `generate_kwargs={"language": "sv", "task": "transcribe"}` is the current way. The plan-written sketch had only `language`; adding `task` makes it more robust against the model trying to translate.

---

## Session 11: HTML documentation site (v0.7)

**Time:** ~11:15
**Duration:** ~30 min
**Commit:** `78ef24a` — Add static HTML documentation site generator

After Phase 2 landed, the README.md had everything — transcripts, screenshots, audio links — but consumption was awkward. The 🎧 audio "link" was just a file URL; clicking it in GitHub did nothing useful, and even in a local markdown viewer it didn't play inline. Screenshots were full-size in the page with no zoom. The doc was complete but not enjoyable to read.

User asked between three directions: easier setup for others, an HTML site for the docs, or something else. Picked the HTML site, with the reasoning that audio is now a first-class artifact and a markdown file hides it.

### Design choices

Wanted a single self-contained file. No npm bundle, no React, no static-site generator. Plain string templates in `src/site.ts` (~280 lines) generating one `index.html` per flow.

The non-obvious choices:

- **`<audio controls>` inline per step.** The browser handles playback natively — no JS library, no custom controls. Just point `src=` at the relative `audio/step-NNN.webm` path. Works offline.
- **TOC scroll-spy via `IntersectionObserver`.** One observer, configured with a `rootMargin` that treats "current step" as the section in the middle-third of the viewport. ~15 lines of vanilla JS, no library.
- **Lightbox without a library.** Click any `<img.screenshot>` → set `src` on a hidden full-screen overlay div and toggle `.open`. Esc and click-outside both close. ~10 lines of JS.
- **Dark mode via `prefers-color-scheme`.** All colors come from CSS custom properties; the `@media (prefers-color-scheme: dark)` block redefines them. Zero JS, zero toggle UI, follows the OS.
- **Auto-emit from capture and transcribe.** Same pattern as markdown/mermaid/notes — both commands call `generateSite()` at the end. `flowdoc site <folder>` is the manual regen escape hatch.

### Wiring

- New `src/site.ts` — `generateSite({ name, startUrl, steps, outputDir })` returns the written file path, mirroring the existing generator signatures.
- `src/capture.ts` — call it after the markdown/mermaid/notes generators.
- `src/transcribe.ts` — call it after `generateMarkdown` so transcripts and site updates land together.
- `src/index.ts` — new `flowdoc site <flow-folder>` subcommand for explicit regen.

### Live test

Ran `node dist/index.js site flowdocs/audio-test4` against the already-transcribed flow from Session 10. Site opened in the default browser showing the 9-step flow with sticky TOC, working inline audio playback, Swedish transcript blockquotes, and lightbox-zoomable screenshots. Dark mode picked up the OS setting correctly.

### What surprised me

- The vanilla-HTML approach was much smaller than I expected. ~280 lines including CSS, JS, and the templating. Would have been a 1000-line React app with a build step. The decision to avoid frameworks here was clearly right.
- `prefers-color-scheme` with CSS custom properties is the cleanest dark-mode story I've used. Two `--var` definitions and the whole page switches.
- `IntersectionObserver` for scroll-spy beats the old `scroll` listener + `getBoundingClientRect` approach by a mile — declarative, debounce-free, and you can tune the trigger zone with `rootMargin`.

---

## Session 12: Onboarding hardening (v0.8)

**Time:** ~12:00
**Duration:** ~50 min
**Commit:** `7c15e97` — Add `flowdoc doctor` + ONBOARDING.md for team setup

After v0.7, the tool was feature-complete enough for a 3-person team to use, but the setup story was scattered across README/QUICKSTART/CLAUDE/ARCHITECTURE and assumed the reader knew what they needed. A teammate could clone the repo and still not know whether their environment was ready before trying to capture something.

The session was *operational* rather than feature work — making the existing pipeline usable by people other than me without hand-holding.

### What shipped

- **`flowdoc doctor`** — 9-row environment checklist with green/yellow/red status: Node version, build output, ffmpeg, system mic, Python, .venv, transformers+torch, Playwright Chromium, MIRO_ACCESS_TOKEN. Diagnose only — never auto-installs. Each non-OK row shows the exact command to run. Warn rows (mic, MIRO token) don't fail the exit code since the core capture+site flow still works.
- **`src/python.ts`** — shared Python resolution. `preferredPython(repoRoot)` checks `.venv/bin/python` first and falls back to system `python3`/`python`. Both `transcribe.ts` and `doctor.ts` use it.
- **`transcribe.ts` auto-detects the venv** — teammates no longer need to `source .venv/bin/activate` in every shell before running `flowdoc transcribe`. If `.venv/bin/python` exists at the repo root, FlowDoc uses it automatically.
- **`ONBOARDING.md`** — single guide that takes a new teammate from `git clone` to first narrated capture in ~15 minutes. Prerequisites with install links, exact command sequence, where to get a Miro token + board ID, three patterns for keeping the token between sessions, how to read the doctor output, and a troubleshooting list. Aimed at developers, not at button-clicking external users.
- **`.env.example`** — committed template listing `MIRO_ACCESS_TOKEN`. The existing `.gitignore` `!.env.example` carve-out (added back in Session 7) means it just works — `.env` stays ignored, `.env.example` is tracked. No dotenv loader added; FlowDoc keeps reading from `process.env` directly. The file is documentation, not behavior.
- **README pointer** — one short callout at the top of the README pointing teammates at `ONBOARDING.md` first, returning users at `QUICKSTART.md`.

### Cross-check with ChatGPT

Same review pattern as earlier sessions. ChatGPT agreed the doctor + onboarding pairing was the right move and the diagnose-only scope was correctly chosen. The one pushback: I'd initially put `.env.example` in the "out of scope" list to keep scope tight; ChatGPT argued it was basic onboarding hygiene (no extra surface, signals to teammates what secrets are expected without putting real ones in docs or Slack). Agreed. Added it back.

### What surprised me

- The auto-prefer-`.venv/bin/python` change is a tiny code change (one helper function, one call-site swap) with disproportionate UX impact. Without it, every fresh terminal session needs `source .venv/bin/activate` before `transcribe` works. With it, the venv is invisible — teammates set it up once and forget it exists.
- Writing the doctor output revealed a real ambiguity: my mic earlier was Fargo at avfoundation device 5, but in this session it's Yeti at device 1. avfoundation device indices aren't stable across connect/disconnect cycles. The mic resolver handles this correctly (resolves by system default name, not index), and `flowdoc doctor` shows the current resolution at the top of every session — exactly the diagnostic I'd want when audio comes out wrong.
- Raw ANSI escape codes (`\x1b[32m...`) for colored output worked perfectly without a `chalk` dependency. The doctor command is ~280 lines including all the colored formatting and stays inside our "no new deps" policy.

---

## Session 13: Local web UI (v0.9)

**Time:** ~13:00
**Duration:** ~90 min (incl. several debugging detours)
**Commit:** `20b83fd` — Add `flowdoc ui` — minimal local web UI to trigger commands

After v0.8 made it easy for a teammate to set up the env, the next friction was remembering the CLI flags. Wanted a discoverable surface — one button per subcommand, live log output, no extra abstractions. Spent the session building `flowdoc ui` and chasing a series of capture-shutdown bugs the UI exposed.

### Architecture

Two new files: `src/ui-server.ts` (~280 lines) and `src/ui-page.ts` (~400 lines). The server is Node's built-in `http.createServer` on a random `127.0.0.1` port. Output streams to the browser over Server-Sent Events. POST endpoints handle start / stop / send-enter / token-override. Single-session model — at most one CLI subcommand running at a time. The flowdocs/ tree is served at `/flowdocs/*` so generated `index.html` sites can be opened directly from the Site card.

The capture two-step UX (open browser, press Enter to start recording, Ctrl+C to stop) maps to three buttons. Start is enabled at first; Start recording appears after the subprocess is alive; Stop only enables after the user has clicked Start recording. This last bit was added after a user clicked Stop before pressing Enter and ended up with an empty `flowdocs/<name>/` folder.

### The capture-shutdown saga

The UI exposed several flaky shutdown paths that the terminal-only flow had hidden. Five fixes landed in this session:

1. **`q\n` to ffmpeg stdin doesn't work when stdin is a pipe.** ffmpeg's interactive command processing only triggers on a TTY. In the terminal, Ctrl+C sent SIGINT to the whole process group (ffmpeg included), which is why it always exited cleanly. Through the UI only the capture process gets SIGINT, so ffmpeg sat idle waiting for the q-command it never read. **Fix:** send `SIGINT` directly to ffmpeg in `audio.ts`. ffmpeg's signal handler writes the WebM trailer and exits with 255.

2. **ffmpeg exit 255 was logged as an error.** After fixing #1, every successful audio shutdown surfaced a "⚠ ffmpeg stop error: ffmpeg exited with code 255" warning. **Fix:** added an `intentionalStop` flag on `AudioRecorder` — any exit during an intentional stop resolves cleanly instead of rejecting.

3. **Empty captures left half-created folders.** If a user clicked Stop before pressing Enter, `ensureScreenshotDir` had already created the folder, but `recorder.steps` was empty so no `workflow-steps.json` got written. Transcribe / Miro then errored on missing files. **Fix:** UI disables Stop until Start-recording is clicked; the dropdowns filter out flows with `stepCount === 0`.

4. **A hung Playwright screenshot blocked shutdown.** Mid-flow navigations occasionally left a pending screenshot in-flight. `recorder.waitForPending()` awaited it forever. **Fix:** wrap with a 4 s timeout; "proceeding with what we have" warning if it trips.

5. **`browser.close()` could stall forever.** Even after all the above, occasionally `await browser.close()` never resolved. **Fix:** fire-and-forget the close; `process.exit(0)` kills Chromium as a side effect anyway. Plus a 30 s watchdog `setTimeout` with `unref()` as belt-and-suspenders.

The shutdown handler now writes `workflow-steps.json` *first* (before any audio or generator work), so even when something later fails, the raw events are preserved.

### What surprised me

- The biggest UX win came from disabling the Stop button until recording has begun. One-line change, eliminated an entire category of "I lost my work" reports.
- Server-Sent Events were the right choice over WebSockets. One-way streaming is exactly what subprocess output is, the browser auto-reconnects, no library needed, and the buffer-replay-on-connect pattern made browser refreshes during a long capture seamless.
- ANSI escape codes in subprocess stdout looked terrible in the HTML log pane. Stripping them server-side with one regex was a 30-second fix.

---

## Session 14: Unikum brand styling + bulletproof shutdown (v0.10)

**Time:** ~15:30
**Duration:** ~45 min
**Commit:** `0a14474` — Unikum-branded Miro shapes + bulletproof capture shutdown

User shared the Unikum kommunikationsguide and the flowchart symbol legend. Wanted the Miro export to match the brand: yellow start circles, blue user-action rectangles, light blue page rectangles, green decision diamonds. No flag — just replace the generic blue-on-white styling.

### The shape mapping

A small `styleFor(node, isFork)` function in `src/miro.ts`:

- `node.isStart` → `circle` (180 × 180), yellow `#FFDB1C`, dark text
- `isFork` (any node with 2+ outgoing edges) → `rhombus` (280 × 200), green `#58B456`, white text
- `node.actionType === "navigation"` OR (`node.actionType === "click"` AND `node.result` set) → `rectangle` (340 × 140), light blue `#C7DDF4`, dark text
- everything else (pure click, input) → `round_rectangle` (340 × 140), blue `#0C69D2`, white text

The fork detection was pleasingly trivial — counting outgoing edges per node:

```ts
const outgoingByFrom = new Map<string, number>();
for (const edge of graph.edges) {
  outgoingByFrom.set(edge.from, (outgoingByFrom.get(edge.from) ?? 0) + 1);
}
const isFork = (nodeId: string) => (outgoingByFrom.get(nodeId) ?? 0) > 1;
```

No schema change required. Branch fork points auto-render as diamonds because `mergeGraphs()` already gives the divergence node two outgoing edges.

### One Miro API gotcha

First push failed with `400 Bad Request: style.borderWidth must be greater than 1.0`. Miro doesn't let you hide a border by setting width to 0. **Fix:** `borderWidth: "2"` with `borderOpacity: "0.0"` — same visual result (no visible border), no API rejection.

### The lingering "Closing browser…" hang

Session 13 ironed out most shutdown paths but one bug survived: occasionally `await browser.close()` never resolved. The user reported it freezing every other capture session. Capture's logs went all the way through "Done! N workflow steps captured." and listed all output files, then stopped at "Closing browser…" for minutes. Eventually the process exited with code 130 (terminated by signal), not a clean `process.exit(0)`.

I never figured out the root cause inside Playwright's IPC. But I didn't need to: the await on `browser.close()` was the load-bearing failure point and the simplest fix was to not await it. `process.exit(0)` kills the Chromium subprocess as a side effect anyway. Added a 30 s watchdog `setTimeout(... , 30000)` with `.unref()` as a final safety net. With those two changes, the UI now sees `__DONE__ 0` within milliseconds of the last generator line.

### What surprised me

- The brand mapping ended up being one helper function and one type-field addition (`result?: string` on `WorkflowNode`). Everything else — fork detection, layout, transcripts as second line — already worked. The right abstraction in v0.5 (graph + layout) made this a one-session change.
- Fire-and-forget for `browser.close()` felt sloppy at first but it's actually correct: the parent is about to die, the OS will reap children, awaiting it just creates new failure modes. The lesson is that "await everything for cleanliness" isn't always right.

---

## Session 15: Desktop app and signed auto-update (v1.0.x)

**Time:** elapsed across roughly a week (2026-05-28 → 2026-06-04)
**Duration:** ~12 hours of focused dev, interleaved with multi-hour waits for Apple notarization and CI builds
**Commits:** `e18e364` … `f9f759e` (on a `desktop-app` branch; `main` left as the v0.10 CLI as a fallback)

This session is its own act. v0.10 ended with a fully working CLI you could hand to a colleague who knew their way around a terminal. The trigger for this session was the opposite: I gave the v0.10 build to a real test user — someone who had never opened a terminal — and they could not get past the install chain (Node, ffmpeg, Python venv, torch, KB-Whisper-large 3 GB, Playwright Chromium). The actual goal became *no terminal, no Python, no manual installs.*

Initial framing of the answer was "host it as a web app with logins." We backed off that quickly during planning — logins were a proxy for the real requirement (zero install), and a hosted browser can't drive *another* browser through Unikum or record the user's mic. A packaged Mac app was the right shape.

### Architecture: the desktop app *is* the CLI

The smallest possible Electron shell. It boots the same HTTP+SSE server that `flowdoc ui` runs and loads it in a BrowserWindow. The server spawns the compiled `dist/index.js` as a child for every subcommand — same pattern as the CLI. One change to support this: `runUi(repoRoot)` extracted into an embeddable `startServer({ appRoot, dataRoot })`.

The two roots really matter:
- **appRoot**: where `dist/index.js` lives — inside `.app/Contents/Resources/app` when packaged, read-only.
- **dataRoot**: where flows are written and served from — `app.getPath('userData')`, writable, survives auto-updates.

The app *is* the CLI: a fix in `src/capture.ts` or `src/site.ts` reaches both at once. `main` stays as the v0.10 CLI; the desktop app lives on a `desktop-app` branch.

### The commander argv bug, caught by a non-GUI spike

Before any UI polish, I smoke-tested the spawn pipeline by running the embedded server *under* Electron-as-Node (`ELECTRON_RUN_AS_NODE=1`) and POSTing `command=doctor` to `/api/start`. Inside the doctor child it returned `error: unknown command '/path/dist/index.js'`.

Diagnosis: commander auto-detects `process.versions.electron` — which is set even when the Electron binary runs as plain Node — and slices `argv` by 1 instead of 2, so it treated `dist/index.js` as the user-supplied command. Every packaged CLI invocation would have silently broken.

Fix:

```ts
program.parse(process.argv, { from: "node" });
```

Caught early thanks to spending an hour on the non-GUI spike rather than the full sign + package + run loop.

### Signing + notarization: the part you only learn by doing

Genuine time sink, and the part the original plan was most optimistic about. Lessons:

- **Xcode's certificate dropdown doesn't list "Developer ID Application"** any more. Created via developer.apple.com instead, with a CSR generated in Keychain Access.
- **Sign with a personal Apple Developer account, not the work team.** I started in the Unikum team and realised the signed binary would identify as Unikum (an internal tool for Unikum demos is fine; surprise-distributing a binary as Unikum is not).
- **`security find-identity -v -p codesigning` returned 0 valid identities** even after the cert showed up in Keychain Access → login → My Certificates. Keychain Access marked it "not trusted." Diagnosis: the Apple Developer ID G2 intermediate CA isn't built into all macOS roots. Fixed by fetching `https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer` and importing — identity went green immediately.
- **First notarization can take hours.** Unofficial Apple behaviour: the first submission from a new Developer account goes through extended review. Ours stayed `In Progress` for over an hour, eventually cleared overnight. Subsequent submissions: 1–5 minutes. Worth knowing before you assume something is wrong with the submission.

### The silent auto-update bug

After v1.0.0 finally landed, I tagged v1.0.1 to test the round-trip. The installed v1.0.0 launched, never detected the new version. Updater cache empty. No outbound GitHub connections from the process. Nothing in macOS unified log.

The key fact: **macOS unified log does not capture Electron stdout** unless the app uses OSLog explicitly. Ours doesn't. So electron-updater can be screaming errors and you'd never see them from the GUI side.

I killed the running FlowDoc and relaunched from terminal with stdout redirected:

```bash
nohup /Applications/FlowDoc.app/Contents/MacOS/FlowDoc > /tmp/flowdoc-stdout.log 2>&1 &
```

Immediately:

```
Error: ZIP file not provided
```

Root cause: electron-updater on macOS applies in-place updates by *unpacking a `.zip`*, not a `.dmg`. The DMG is the first-run installer. We had `"target": "dmg"` only, so `latest-mac.yml` referenced just that, and the updater silently rejected it.

Fix in v1.0.2: `"target": ["dmg", "zip"]`. v1.0.0 → v1.0.2 auto-update round-trip then worked first try.

The general lesson worth carrying forward: **when an Electron app misbehaves and the GUI gives you nothing, relaunch it from terminal with stdout captured.** The OS log won't help.

### CI release pipeline

`.github/workflows/release.yml` triggers on every `v*` tag: build, sign, notarize, publish a non-draft GitHub Release with both DMG and ZIP plus `latest-mac.yml`. Five repo secrets:

| Secret | What |
|---|---|
| `CSC_LINK` | base64 of the `.p12` exported from Keychain Access |
| `CSC_KEY_PASSWORD` | the `.p12` export password |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | from account.apple.com — revocable, scoped, regenerated per release |
| `APPLE_TEAM_ID` | 10-char team identifier |

`publish.releaseType: "release"` added in v1.0.1 to skip electron-builder's draft default — drafts aren't visible to the auto-updater. The dev workflow from v1.0.2 onwards: bump `version`, `git tag vX.Y.Z`, `git push --tags`, done.

### v1.0.4: drop Python entirely, swap to whisper.cpp

The original v2 plan landed here. The v1.0.3 desktop app shipped with a Transcribe button that errored on every machine without a Python venv — the deferred work surfacing exactly as predicted.

Used the `nodejs-whisper` npm package for its bundled whisper.cpp source + cmake build, but invoked the compiled binary directly rather than the package's API. The library has hidden gotchas: it calls `ffmpeg` from PATH (not our bundled `FLOWDOC_FFMPEG`) and mutates `process.cwd()` via shelljs in its model-download path. Bypassing the API and shelling out to the compiled binary ourselves sidesteps both.

First packaged build failed with `ENOENT: no such file or directory, ensureSymlink 'libwhisper.1.dylib'` — electron-builder choked on whisper.cpp's dylib symlinks. Fix: `-DBUILD_SHARED_LIBS=OFF` produces a static binary with no dylibs.

CMake build has to happen during `npm install` postinstall, not lazily at first transcribe — `node_modules` is read-only inside the packaged app, so a runtime cmake invocation has nowhere to write. macos-14 CI runners have cmake pre-installed; dev machines need `brew install cmake`.

Removed in the same release: `scripts/transcribe.py`, `src/python.ts`, `requirements.txt`. Doctor lost the Python / venv / transformers checks and gained a `whisper-cli` binary check.

Model: initially the multilingual `small` (~500 MB, simplest first move). Replaced with `kb-whisper-medium-q5_0` in v1.0.7 once it became clear the multilingual model produced gibberish on Swedish-specific vocabulary ("skömposter" for the actual word "schemaposter"). The KBLab Q5_0-quantized medium is the same ~500 MB download but Swedish-tuned, with negligible quality cost from quantization.

### v1.0.5: a real update dialog (instead of "did anything happen?")

`checkForUpdatesAndNotify()` worked but felt erratic — the only visible signal was a macOS notification, easy to miss, with no UI in between *we found something* and *restart to apply.* Replaced with explicit event handlers:

- `update-available` → `dialog.showMessageBox` with release notes fetched from the GitHub release body via the public API. Buttons: **Install and Restart** / **Later** / **Skip This Version**.
- `update-not-available` → silent on launch; on a manual check, shows *"FlowDoc is up to date."*
- Skipped versions persist in `userData`; a manual menu check overrides skip.
- New **Check for Updates…** menu item under the FlowDoc app menu.

This was also the first time we set our own `Menu.setApplicationMenu`, which means including `{ role: "editMenu" }` etc. explicitly so cut/copy/paste shortcuts still work in text fields.

### v1.0.6 → v1.0.8: polish

- **v1.0.6**: doctor no longer surfaces the `MIRO_ACCESS_TOKEN` env-var warning inside the desktop app. The in-app token field is the right channel; the CLI-style `export …` fix hint was just noise. Detected via `process.versions.electron`.
- **v1.0.7**: model swap to `kb-whisper-medium-q5_0` as above, plus auto-cleanup of stale model files in `userData` (so existing users reclaim the ~465 MB `ggml-small.bin`).
- **v1.0.8**: live download UX. The previous "...10% (50 MB)" emits every ten-percent felt like a hang on a ~500 MB download. Now every 5 seconds we emit progress *and* a rotating message, alternating onboarding tip → zen koan → onboarding tip → zen koan:

```
   42%  ·  214 MB / 510 MB  ·  11.8 MB/s  ·  ~25s left
   Tip: Re-run Transcribe any time — finished steps are skipped automatically.

   50%  ·  255 MB / 510 MB  ·  11.6 MB/s  ·  ~22s left
   The obstacle is the bandwidth.
```

### What surprised me

- **The "desktop app *is* the CLI" architecture made the whole session shorter than I'd guessed.** The single biggest decision was treating the existing `flowdoc ui` server as the desktop app's backbone. Almost every "how do we…" question that came up — how does capture work, how does the audio path resolve, how do we serve the generated site, how do we drive a long-running subprocess — had been answered already by the CLI work in Sessions 1–14. The desktop app added a window, a signing pipeline, and ~30 MB of glue.
- **Most of the hard time wasn't engineering, it was Apple.** First-notarization hours, hunting down the G2 intermediate trust issue, the "ZIP file not provided" silent failure — none of these are Electron-specific. They're macOS distribution-specific. The genuinely Electron-specific bug (commander mis-parsing argv) was caught in an hour by a non-GUI spike before it could hide.
- **`nohup … > /tmp/log` is the single most useful Electron debugging recipe.** Worth remembering: the moment an Electron app misbehaves and the GUI shows nothing, relaunch it from terminal. The unified log will not save you.
- **Quantized whisper models are absurdly good.** A 5-bit quantized KB-Whisper-medium delivers Swedish quality I'd have expected from full-precision medium, in the same ~500 MB download as the multilingual small that was producing nonsense. Modern model quantization is one of those quietly-revolutionary infrastructure things.

---

## Session 16: Return after three months (v1.0.9 → v1.0.10)

**Time:** 2026-09-02, ~1.5 hours
**Commits:** `c788c3a` … `1f03347`

The first session after a three-month gap, and the shape of it was set by that gap: almost every problem was a *stale-knowledge* problem rather than an engineering one.

### The Miro token detour

Started with "how do I get a Miro API key" and lost close to an hour to bad assumptions before writing any code:

- Miro has no standalone API key. Every token belongs to an app, and every app lives in a **Developer team**. `Profile settings → Your apps` shows no "Create new app" button until that team exists — which reads as a permissions problem and isn't one. The direct link is `https://miro.com/app/dashboard/?createDevTeam=1`.
- The team-admin `Apps & Integrations` page is a different thing entirely — it lists apps installed on the team and only offers "Remove for team". No tokens there.
- Worth knowing for later: tokens from the OAuth flow last 60 minutes with a 60-day refresh token. The install-button token has historically been long-lived. It's an app-level setting, so decide it deliberately.

`ONBOARDING.md` and `src/doctor.ts` both gave the incomplete "Create new app → Install on team" instruction. Both now name the Developer team step.

### The bug that started it

Pasting a board URL into `--board` (or the app's Board ID field) sent the whole URL percent-encoded into the API path: `400 Ambiguous URI path separator`. `normalizeBoardId()` now strips the URL wrapper, trailing slashes, query params, and `%3D`-style encoding. Bare IDs pass through untouched.

Then the fixed build didn't fix anything, because the packaged app carries its own copy of `dist/` inside the bundle — the June build was still running. Obvious in hindsight, invisible in the moment.

### Docs as a failure mode

`CLAUDE.md` still described the Python/torch transcription stack that v1.0.4 deleted three months earlier: `scripts/transcribe.py`, `src/python.ts`, `requirements.txt`, venv auto-detection. Since that file is what briefs a fresh session, the stale version actively produced venv-flavoured advice for a project with no Python in it.

That's the lesson worth keeping: **a stale `CLAUDE.md` is worse than no `CLAUDE.md`**, because it is trusted. The same rot had spread to `README.md`, `ONBOARDING.md`, `QUICKSTART.md`, and `ARCHITECTURE.md` — all four still walked new users through `pip install -r requirements.txt`. All five files now match the code.

### Two real fixes

- **The Miro token didn't survive a restart.** It lived only in `ui-server`'s module scope, so quitting — or taking an auto-update — lost it, and the desktop app has no env-var fallback since v1.0.6 hid that check. `startServer` now takes an optional `secretStore`; the Electron shell supplies one backed by `safeStorage`, encrypting against a macOS Keychain key. If encryption is unavailable it declines to write rather than putting a bearer token on disk in plaintext. The plain CLI passes no store and keeps the in-memory behaviour.
- **The app icon rendered as a hard-edged white square.** The artwork *depicted* a rounded tile, but the PNG was opaque — `sips -g hasAlpha` said `no` — and **macOS does not mask app icons**. The tile and the background behind it were both near-white, so only a faint drop shadow suggested a rounded edge; on a dark desktop it vanished. Rebuilt on Apple's grid: an 824×824 superellipse body in a 1024 canvas with a 100 px transparent margin.

  First attempt looked dirty. Cropping the original tile and masking it dragged the baked drop shadow inside the new border, because an n=5 squircle is *fuller* at the corners than the source's rounded rect — the mask kept pixels that had been outside the original shape. Fix: fill the body flat, composite only the logo. Also committed `build/icon.png`, the 1024 master, which didn't exist in the repo and had to be reverse-engineered out of the `.icns`.

### What surprised me

- **Three months is long enough to lose the whole mental model.** Not the concepts — the specifics. Which stack transcription uses, where the token lives, whether the app runs the repo's `dist/`. `BUILD_LOG.md` and `git log` reconstructed it in about five minutes, which is the strongest argument yet for keeping both.
- **Documentation rot has a compounding cost with an AI collaborator.** A human skims a stale README and notices it doesn't match. A fresh session takes it as ground truth and confidently acts on it. The doc *is* the interface.
- **macOS icon corners are not automatic.** Every rounded app icon in the Dock ships its corners baked into the artwork with real transparency. Easy to assume the OS handles it; it doesn't.

---

## Summary

| Version | What | Key Change |
|---|---|---|
| v0.1 | `ed4b6bd` | Working CLI — captures clicks, inputs, navigation with screenshots |
| v0.1.1 | `f8a6a9f` | Bug fix — inject script into already-loaded page |
| v0.2 | `64ecea9` | Post-processing — dedup, merge, titles, Mermaid flowchart |
| v0.2.1 | `23cd133` | Strip file extensions from page names |
| v0.3 | `694ba56` | Always wait for Enter, detect silent URL changes |
| — | `35f6516` | README and CLAUDE.md |
| v0.4 | `d2e8fb7` | Miro export — `flowdoc miro` subcommand, always emit `workflow-steps.json` |
| — | `ba8cf77` | Defensive `.gitignore` for secrets |
| v0.5 | `0ae6b4c` | Branching — graph model, `--branch` flag, shared-prefix detection, Y-fork layout |
| v0.6a | `e981446` | Live audio narration during capture (ffmpeg + per-step slicing) |
| v0.6a.1 | `2016d07` | Auto-detect macOS default mic, `--mic` override, 48 kHz / voip Opus tuning |
| v0.6b | `f2052a8` | Local Swedish whisper transcription via KBLab + Python subprocess |
| v0.7 | `78ef24a` | Static HTML documentation site (`flowdoc site`, auto-emitted by capture + transcribe) |
| v0.8 | `7c15e97` | `flowdoc doctor` + ONBOARDING.md + venv auto-detect for transcribe |
| v0.9 | `20b83fd` | Local web UI (`flowdoc ui`) — one card per subcommand, live SSE log, two-step capture buttons; plus shutdown fixes for the bugs the UI exposed |
| v0.10 | `0a14474` | Miro export uses Unikum brand palette + flowchart symbols; capture shutdown watchdog + fire-and-forget `browser.close()` |
| — | `e18e364` | Electron desktop shell + embeddable server + auto-update wiring (on `desktop-app` branch) |
| — | `ce5b3ff` | Release pipeline: `notarize: true`, repository field for publish target |
| v1.0.0 | — | First signed + notarized release (first-notarization wait was hours) |
| v1.0.1 | `9ed3881` | `publish.releaseType: "release"`, explicit owner/repo so installed apps know where to look |
| v1.0.2 | `3146410` | `target: ["dmg", "zip"]` — fixes the silent auto-update failure on macOS |
| v1.0.3 | `7230726` | Custom app icon via `iconutil` from a 1024×1024 PNG |
| v1.0.4 | `4ed98f7`, `d6745ce` | whisper.cpp replaces Python + torch; remove `scripts/transcribe.py`, `src/python.ts`, `requirements.txt` |
| v1.0.5 | `e598e81` | Native update dialog with release notes + Check for Updates menu item |
| v1.0.6 | `b675b0c` | Hide `MIRO_ACCESS_TOKEN` env-var warning in the packaged app (CLI still shows it) |
| v1.0.7 | `4986c2b` | Swap whisper model to KB-Whisper-medium Q5_0 (Swedish-tuned) + auto-cleanup of stale models |
| v1.0.8 | `f9f759e` | Download UX: live speed + ETA + alternating onboarding tip / zen koan during the ~500 MB first-run download |
| v1.0.9 | `c788c3a` | `--board` accepts a pasted board URL; `CLAUDE.md` refreshed against the post-v1.0.4 codebase |
| v1.0.10 | `599f262`, `ccce8b1` | Miro token persisted via `safeStorage`; app icon rebuilt as a real squircle with transparency |

**Total time:**
- **v0.1 → v0.10**: ~7.5 hours from empty repo to a narrated-workflow CLI with local Swedish transcription, Miro export, and a self-contained HTML site.
- **v1.0.0 → v1.0.8**: ~12 hours of focused dev across roughly a week, taking that same CLI all the way to a signed, notarized, auto-updating Mac app that any non-technical user can install with one double-click. Notarization waits and CI runs added several hours of wall-clock idle.

**Test sites used:**
- mantus.ai — public SPA, validated click/navigation capture
- demo.unikum.net — enterprise app with login, validated password masking, form inputs, and Miro export

**Tools:** TypeScript, Playwright, Commander, Miro REST v2 (via global `fetch`). Desktop phase added Electron, electron-builder, electron-updater, ffmpeg-static, nodejs-whisper, cmake (system dep on dev/CI), GitHub Actions for the release pipeline. No third-party services beyond Apple's notary and GitHub Releases.

**Process:** Planning with ChatGPT cross-check, implementation with Claude Code (Opus 4.6 → 4.7), manual browser testing between iterations. Each session was focused: plan → build → test → fix → commit. The desktop phase added one more habit: **terminal-stdout debugging** for any Electron weirdness — the GUI tells you nothing and macOS unified log doesn't catch Electron stdout.
