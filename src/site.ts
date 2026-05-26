import * as fs from "fs";
import * as path from "path";
import { WorkflowStep } from "./types";
import { pageName } from "./postprocess";

interface SiteOptions {
  name: string;
  startUrl: string;
  steps: WorkflowStep[];
  outputDir: string;
}

export async function generateSite(options: SiteOptions): Promise<string> {
  const { name, startUrl, steps, outputDir } = options;
  const title = toTitleCase(name);
  const capturedAt = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  const startStep = steps.find((s) => s.rawSteps[0].action === "start");
  const workflowSteps = steps.filter((s) => s.rawSteps[0].action !== "start");
  const totalAudioMs = steps.reduce((sum, s) => sum + (s.narration?.durationMs ?? 0), 0);
  const audioBadge = totalAudioMs > 0 ? `${(totalAudioMs / 1000).toFixed(1)}s narration` : "no narration";

  const tocItems: string[] = [];
  const stepSections: string[] = [];

  if (startStep) {
    tocItems.push(tocItem("start", `Start: ${escapeHtml(pageName(startStep.url))}`));
    stepSections.push(renderStartStep(startStep));
  }

  workflowSteps.forEach((step, i) => {
    const id = `step-${i + 1}`;
    tocItems.push(tocItem(id, `${i + 1}. ${escapeHtml(step.title)}`));
    stepSections.push(renderStep(step, i + 1, id));
  });

  const html = pageTemplate({
    title,
    startUrl,
    capturedAt,
    stepCount: workflowSteps.length,
    audioBadge,
    tocHtml: tocItems.join("\n"),
    stepsHtml: stepSections.join("\n"),
  });

  const indexPath = path.join(outputDir, "index.html");
  await fs.promises.writeFile(indexPath, html, "utf-8");
  return indexPath;
}

function tocItem(id: string, label: string): string {
  return `<a class="toc-item" href="#${id}" data-target="${id}">${label}</a>`;
}

function renderStartStep(step: WorkflowStep): string {
  const transcript = step.narration?.transcript
    ? `<blockquote>${escapeHtml(step.narration.transcript)}</blockquote>`
    : "";
  const audio = step.narration
    ? `<audio controls preload="metadata" src="${encodeURI(step.narration.audioPath)}"></audio>`
    : "";
  const screenshot = step.screenshotPath
    ? `<img class="screenshot" src="${encodeURI(step.screenshotPath)}" alt="Start screenshot" data-fullsrc="${encodeURI(step.screenshotPath)}">`
    : "";
  return `
<section class="step" id="start">
  <header class="step-header">
    <span class="step-tag start-tag">Start</span>
    <h2>${escapeHtml(pageName(step.url))}</h2>
  </header>
  ${transcript}
  ${audio}
  ${screenshot}
</section>`;
}

function renderStep(step: WorkflowStep, num: number, id: string): string {
  const transcript = step.narration?.transcript
    ? `<blockquote>${escapeHtml(step.narration.transcript)}</blockquote>`
    : "";
  const audio = step.narration
    ? `<audio controls preload="metadata" src="${encodeURI(step.narration.audioPath)}"></audio>`
    : "";
  const screenshot = step.screenshotPath
    ? `<img class="screenshot" src="${encodeURI(step.screenshotPath)}" alt="Step ${num} screenshot" data-fullsrc="${encodeURI(step.screenshotPath)}">`
    : "";
  const valueLine = step.value
    ? `<p class="value"><strong>Value:</strong> ${escapeHtml(step.value)}</p>`
    : "";
  const actionLine = step.result
    ? `<p class="action">${escapeHtml(step.action)} → <em>${escapeHtml(step.result)}</em></p>`
    : `<p class="action">${escapeHtml(step.action)}</p>`;
  const technical = `
    <details class="tech">
      <summary>Technical details</summary>
      ${step.selector ? `<p><strong>Element:</strong> <code>${escapeHtml(step.selector)}</code></p>` : ""}
      <p><strong>URL:</strong> <code>${escapeHtml(step.url)}</code></p>
    </details>`;
  return `
<section class="step" id="${id}">
  <header class="step-header">
    <span class="step-tag">${num}</span>
    <h2>${escapeHtml(step.title)}</h2>
  </header>
  ${actionLine}
  ${valueLine}
  ${transcript}
  ${audio}
  ${screenshot}
  ${technical}
</section>`;
}

interface PageOptions {
  title: string;
  startUrl: string;
  capturedAt: string;
  stepCount: number;
  audioBadge: string;
  tocHtml: string;
  stepsHtml: string;
}

function pageTemplate(o: PageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)} — FlowDoc</title>
<style>
  :root {
    --bg: #fafaf9;
    --surface: #ffffff;
    --border: #e5e5e3;
    --text: #1a1a1a;
    --text-dim: #6b6b6b;
    --accent: #2d9bf0;
    --accent-soft: #e8f3fd;
    --start: #4caf50;
    --start-soft: #e8f5e9;
    --code-bg: #f4f4f1;
    --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #131312;
      --surface: #1c1c1b;
      --border: #2c2c2a;
      --text: #f0f0ee;
      --text-dim: #9c9c9a;
      --accent: #4eaff5;
      --accent-soft: #1a3247;
      --start: #5fc262;
      --start-soft: #1a2f1c;
      --code-bg: #232321;
      --shadow: 0 1px 3px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; line-height: 1.55; }
  .layout { display: grid; grid-template-columns: 260px 1fr; min-height: 100vh; }
  @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } .toc { display: none; } }
  .toc { background: var(--surface); border-right: 1px solid var(--border); padding: 28px 16px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .toc-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); margin: 0 0 14px 8px; }
  .toc-item { display: block; padding: 6px 8px; border-radius: 6px; font-size: 13px; color: var(--text); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
  .toc-item:hover { background: var(--code-bg); }
  .toc-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .main { padding: 40px 56px 80px; max-width: 880px; }
  @media (max-width: 800px) { .main { padding: 24px 20px 60px; } }
  .header { border-bottom: 1px solid var(--border); padding-bottom: 24px; margin-bottom: 36px; }
  h1 { font-size: 32px; margin: 0 0 10px; letter-spacing: -0.01em; }
  .meta { color: var(--text-dim); font-size: 14px; display: flex; flex-wrap: wrap; gap: 16px; }
  .meta a { color: var(--accent); text-decoration: none; }
  .meta a:hover { text-decoration: underline; }
  .step { margin-bottom: 48px; }
  .step-header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  .step-tag { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; padding: 0 10px; border-radius: 8px; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 14px; }
  .step-tag.start-tag { background: var(--start-soft); color: var(--start); }
  h2 { margin: 0; font-size: 20px; letter-spacing: -0.005em; }
  .action { margin: 0 0 12px; color: var(--text-dim); font-size: 14px; }
  .action em { font-style: normal; color: var(--text); }
  .value { margin: 0 0 12px; font-size: 14px; }
  blockquote { margin: 12px 0; padding: 12px 16px; border-left: 3px solid var(--accent); background: var(--accent-soft); border-radius: 0 6px 6px 0; font-size: 15px; }
  audio { display: block; width: 100%; max-width: 460px; margin: 12px 0 14px; }
  img.screenshot { display: block; max-width: 100%; border: 1px solid var(--border); border-radius: 8px; cursor: zoom-in; box-shadow: var(--shadow); margin: 14px 0; }
  .tech { margin-top: 14px; font-size: 13px; color: var(--text-dim); }
  .tech summary { cursor: pointer; padding: 6px 0; user-select: none; }
  .tech p { margin: 6px 0; }
  code { background: var(--code-bg); padding: 1px 6px; border-radius: 4px; font-size: 12px; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: none; align-items: center; justify-content: center; z-index: 100; cursor: zoom-out; padding: 20px; }
  .lightbox.open { display: flex; }
  .lightbox img { max-width: 95%; max-height: 95%; border-radius: 8px; }
</style>
</head>
<body>
<div class="layout">
  <nav class="toc">
    <p class="toc-title">Steps</p>
    ${o.tocHtml}
  </nav>
  <main class="main">
    <header class="header">
      <h1>${escapeHtml(o.title)}</h1>
      <div class="meta">
        <span>${o.stepCount} step${o.stepCount === 1 ? "" : "s"}</span>
        <span>${escapeHtml(o.audioBadge)}</span>
        <span>captured ${escapeHtml(o.capturedAt)}</span>
        <a href="${escapeHtml(o.startUrl)}" target="_blank" rel="noopener">start URL ↗</a>
      </div>
    </header>
    ${o.stepsHtml}
  </main>
</div>

<div class="lightbox" id="lightbox" aria-hidden="true"><img id="lightbox-img" alt=""></div>

<script>
  (function() {
    const lb = document.getElementById('lightbox');
    const lbImg = document.getElementById('lightbox-img');
    document.querySelectorAll('img.screenshot').forEach((img) => {
      img.addEventListener('click', () => {
        lbImg.src = img.dataset.fullsrc || img.src;
        lb.classList.add('open');
        lb.setAttribute('aria-hidden', 'false');
      });
    });
    lb.addEventListener('click', () => {
      lb.classList.remove('open');
      lb.setAttribute('aria-hidden', 'true');
      lbImg.src = '';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lb.classList.contains('open')) {
        lb.classList.remove('open');
        lb.setAttribute('aria-hidden', 'true');
        lbImg.src = '';
      }
    });

    const tocLinks = Array.from(document.querySelectorAll('.toc-item'));
    const sections = tocLinks
      .map((a) => document.getElementById(a.dataset.target))
      .filter((s) => s);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          tocLinks.forEach((a) => a.classList.toggle('active', a.dataset.target === id));
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
    sections.forEach((s) => observer.observe(s));
  })();
</script>
</body>
</html>`;
}

function toTitleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
