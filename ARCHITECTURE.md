# FlowDoc — How it works

A walkthrough of the moving parts behind `flowdoc capture` and `flowdoc miro`, written so the design choices are explainable without reading the source.

## The architecture in one sentence

FlowDoc launches a real Chromium browser, injects a JavaScript snitch into every page, listens for the user's clicks/inputs/navigations from Node via a bidirectional bridge, screenshots each event, then post-processes the raw event stream into clean steps that get rendered to Markdown, Mermaid, JSON, and Miro.

## Playwright's job

Playwright is doing four distinct things, none of them obvious from the README:

1. **Launches a visible browser** — `chromium.launch({ headless: false, args: ["--start-maximized"] })` in `src/capture.ts`. Not headless: the user *is* the test driver. The `viewport: null` on the context tells Playwright "don't override the window size with your default 1280×720, use whatever the OS gives you" — that's what lets the maximized window matter.

2. **Creates a Node ↔ browser bridge** — `page.exposeFunction("__flowdoc_report", callback)` in `src/recorder.ts`. That single line creates a function called `__flowdoc_report` *inside the browser's JavaScript world* that, when called, invokes a Node callback. Playwright serialises the argument across the process boundary. This is the trick that makes recording possible: the browser-side script can shout events back to Node, and Node decides what to do with them.

3. **Injects the recording script into every page** — two flavours:
   - `page.addInitScript(INJECTED_SCRIPT)` — runs the script on every *future* page load, including after the user clicks a link that navigates away.
   - `page.evaluate(INJECTED_SCRIPT)` — runs it on the *current* page right now. Needed because `addInitScript` only fires on the next navigation, and the page is already loaded by the time the user presses Enter. (This bug was the first thing that broke in early testing — see `BUILD_LOG.md` Session 2.)

4. **Takes screenshots** — `page.screenshot({ path, ... })` in `src/screenshot.ts`, fired once per recorded event so every step in the documentation has a visual.

`context.on("page", ...)` handles new tabs and popups by re-running setup on each new page.

## The recording loop

The injected script (`INJECTED_SCRIPT` constant in `src/recorder.ts`) is a self-contained IIFE that:

- Listens for `click` events in capture phase, builds a CSS selector for the target (prefers `#id`, then `data-testid`, then `name`, then `aria-label`, then a `tag:nth-of-type` path), and reports it.
- Listens for `input` events with a 500ms debounce so typing a 12-character word doesn't produce 12 events. Masks password fields as `********` before reporting.
- Wraps `history.pushState` / `history.replaceState` and listens for `popstate` / `hashchange` to catch SPA navigations that don't trigger a full page load.

Every reported event triggers a Node-side handler that waits 300ms for the DOM to settle, snaps a screenshot, and appends a `RecordedStep` to an in-memory array.

## Why post-processing exists

Raw browser events ≠ workflow steps. A single user action like "click Login" can fire two click events (bubbling), then a navigation, plus sometimes a silent URL change. `src/postprocess.ts` runs a 4-pass pipeline:

1. **Dedup nested clicks** — adjacent clicks within 500ms collapse into the one with the shorter description (the inner element the user actually targeted).
2. **Merge click + navigation** — `click` followed by `navigation` within 2s becomes one logical "Open X" step. Also detects *silent* navigations: a click whose `url` differs from the next step's `url` is annotated as causing navigation even though no navigation event fired.
3. **Generate titles** — turns raw `"Clicked link 'Learn'"` into human `"Open 'Learn'"`, etc.
4. **Reindex** so the final array has clean sequential `index` values.

The output is `WorkflowStep[]` — the data structure every generator consumes.

## Generation

Four files come out of `flowdocs/<name>/`:

- `README.md` — `src/markdown.ts`. Per-step sections with embedded screenshot paths, action → result lines, collapsible technical details (selector, full URL).
- `flow.mmd` — `src/mermaid.ts`. Mermaid flowchart of page-to-page transitions.
- `notes-template.md` — `src/notes.ts`. Empty per-step sections for human annotation.
- `workflow-steps.json` — the processed steps verbatim. This is the *machine-readable* artifact that `flowdoc miro` reads.

## The Miro export

`flowdoc miro` reads `workflow-steps.json`, runs it through `src/graph.ts` to convert into a `WorkflowGraph` (nodes + edges), then POSTs to Miro's REST v2 API:

- `POST /v2/boards/{id}/shapes` per node — rounded rectangles with explicit `style` (4px green border for start, blue for others, white fill, 20px Open Sans).
- `POST /v2/boards/{id}/connectors` per edge — elbowed lines with `endStrokeCap: arrow`, short captions like `click` / `type` / `navigate`.

Shapes must be created first so each connector can reference the returned Miro IDs. Calls are made sequentially with a soft rate-limit cushion: if `X-RateLimit-Remaining` drops below 10% of `X-RateLimit-Limit`, the next request waits a second before going out.

### Branching

Branching works by capturing two flows that share a starting URL and the first few clicks. `mergeGraphs()` in `src/graph.ts` walks both step arrays in lockstep, comparing `url + selector + action type`, stops at the first mismatch, and forks the branch at that point. `layoutGraph()` then assigns each node a position: depth from the start → x, which flow it belongs to → y (main = 0, branch1 = -260, branch2 = +260, …).

Branches end independently in this version — no diamond convergence — and a branch that shares no prefix with main, is fully contained in main, or is empty is warned and skipped rather than fatal.

## The Node ↔ browser dance

If you want one mental model: Playwright lets Node and browser JavaScript talk to each other across a process boundary. The browser script reports events; Node receives them, takes screenshots, and appends to an array. When the user presses Ctrl+C, Node processes that array and writes files. The browser is just the world the user acts in; Node is the observer taking notes.

No agents, no AI calls in the capture path. The whole thing is deterministic: same clicks → same output.

## Source map

| File | Role |
|---|---|
| `src/index.ts` | Commander CLI — `capture` and `miro` subcommands |
| `src/capture.ts` | Launches Playwright, waits for Enter, owns the recorder lifecycle, fires post-processing + generation on Ctrl+C |
| `src/recorder.ts` | The injected browser script + the Node-side event handler that turns events into `RecordedStep`s |
| `src/postprocess.ts` | 4-pass pipeline: `RecordedStep[]` → `WorkflowStep[]` |
| `src/markdown.ts` | Renders `README.md` from steps |
| `src/mermaid.ts` | Renders `flow.mmd` flowchart |
| `src/notes.ts` | Renders `notes-template.md` |
| `src/graph.ts` | `WorkflowStep[]` → `WorkflowGraph`, branch merging, layout |
| `src/miro.ts` | Pushes a `WorkflowGraph` to Miro via REST v2 |
| `src/screenshot.ts` | Wraps `page.screenshot()` + ensures the output dir exists |
| `src/types.ts` | Shared TypeScript interfaces |
