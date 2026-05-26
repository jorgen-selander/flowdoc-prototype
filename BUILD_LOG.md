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

## Summary

| Version | What | Key Change |
|---|---|---|
| v0.1 | `ed4b6bd` | Working CLI — captures clicks, inputs, navigation with screenshots |
| v0.1.1 | `f8a6a9f` | Bug fix — inject script into already-loaded page |
| v0.2 | `64ecea9` | Post-processing — dedup, merge, titles, Mermaid flowchart |
| v0.2.1 | `23cd133` | Strip file extensions from page names |
| v0.3 | `694ba56` | Always wait for Enter, detect silent URL changes |
| — | `35f6516` | README and CLAUDE.md |

**Total time:** ~2 hours from empty repo to documented, working tool.

**Test sites used:**
- mantus.ai — public SPA, validated click/navigation capture
- demo.unikum.net — enterprise app with login, validated password masking and form inputs

**Tools:** TypeScript, Playwright, Commander. No AI APIs, no external services, no build tools beyond `tsc`.

**Process:** Planning with ChatGPT cross-check, implementation with Claude Code, manual browser testing between iterations. Each session was focused: plan → build → test → fix → commit.
