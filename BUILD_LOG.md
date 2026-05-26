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

**Total time:** ~6 hours from empty repo to a tool that records narrated browser workflows, transcribes them locally, publishes the result as both a Miro board with native editable shapes AND a self-contained HTML site with inline audio playback, and has a one-command environment checker for new teammates.

**Test sites used:**
- mantus.ai — public SPA, validated click/navigation capture
- demo.unikum.net — enterprise app with login, validated password masking, form inputs, and Miro export

**Tools:** TypeScript, Playwright, Commander, Miro REST v2 (via global `fetch`). No AI APIs, no external services, no build tools beyond `tsc`.

**Process:** Planning with ChatGPT cross-check, implementation with Claude Code (Opus 4.6 → 4.7), manual browser testing between iterations. Each session was focused: plan → build → test → fix → commit.
