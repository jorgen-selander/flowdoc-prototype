import { RecordedStep, WorkflowStep } from "./types";

export function pageName(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    if (pathname === "/" || pathname === "") return "Home";
    let last = pathname.split("/").filter(Boolean).pop() || "Page";
    last = last.replace(/\.\w+$/, "");
    if (!last) return "Home";
    return last
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  } catch {
    return "Page";
  }
}

function urlPathname(url: string): string {
  try { return new URL(url).pathname; }
  catch { return url; }
}

// Pass 1: Deduplicate adjacent nested clicks
function deduplicateClicks(steps: RecordedStep[]): RecordedStep[] {
  const result: RecordedStep[] = [];
  let i = 0;
  while (i < steps.length) {
    if (
      i + 1 < steps.length &&
      steps[i].action === "click" &&
      steps[i + 1].action === "click" &&
      Math.abs(steps[i + 1].timestamp - steps[i].timestamp) < 500
    ) {
      const textA = steps[i].description;
      const textB = steps[i + 1].description;
      // Keep the one with shorter/cleaner text (inner element)
      if (textA.length <= textB.length) {
        result.push(steps[i]);
      } else {
        result.push(steps[i + 1]);
      }
      i += 2;
    } else {
      result.push(steps[i]);
      i++;
    }
  }
  return result;
}

// Pass 2: Merge click + immediate navigation pairs
function mergeClickNav(steps: RecordedStep[]): WorkflowStep[] {
  const result: WorkflowStep[] = [];
  let i = 0;
  while (i < steps.length) {
    if (
      i + 1 < steps.length &&
      steps[i].action === "click" &&
      steps[i + 1].action === "navigation" &&
      steps[i + 1].timestamp - steps[i].timestamp < 2000
    ) {
      const click = steps[i];
      const nav = steps[i + 1];
      result.push({
        index: 0, // re-indexed later
        title: "", // generated later
        action: click.description,
        result: `Navigated to ${pageName(nav.url)}`,
        url: nav.url,
        selector: click.selector,
        value: click.value,
        screenshotPath: nav.screenshotPath || click.screenshotPath,
        rawSteps: [click, nav],
      });
      i += 2;
    } else if (
      i + 1 < steps.length &&
      steps[i].action === "click" &&
      urlPathname(steps[i].url) !== urlPathname(steps[i + 1].url)
    ) {
      // Silent URL change: click caused navigation without a navigation event
      const click = steps[i];
      result.push({
        index: 0,
        title: "",
        action: click.description,
        result: `Navigated to ${pageName(steps[i + 1].url)}`,
        url: steps[i + 1].url,
        selector: click.selector,
        value: click.value,
        screenshotPath: click.screenshotPath,
        rawSteps: [click],
      });
      i++;
    } else {
      const step = steps[i];
      result.push({
        index: 0,
        title: "",
        action: step.description,
        result: "",
        url: step.url,
        selector: step.selector,
        value: step.value,
        screenshotPath: step.screenshotPath,
        rawSteps: [step],
      });
      i++;
    }
  }
  return result;
}

// Extract click text from raw description like "Clicked link 'Learn'" → "Learn"
function extractClickText(description: string): string {
  const match = description.match(/'([^']+)'/);
  return match ? match[1] : "";
}

// Pass 3: Generate workflow titles
function generateTitles(steps: WorkflowStep[]): void {
  for (const step of steps) {
    const raw = step.rawSteps[0];
    if (raw.action === "start") {
      step.title = `Start: ${pageName(step.url)}`;
    } else if (raw.action === "click" && step.result) {
      // Click that caused navigation (explicit or silent)
      const text = extractClickText(step.action);
      step.title = text ? `Open "${text}"` : `Navigate to ${pageName(step.url)}`;
    } else if (raw.action === "click") {
      const text = extractClickText(step.action);
      step.title = text ? `Click "${text}"` : `Click element`;
    } else if (raw.action === "input") {
      const label = raw.value ? `"${raw.value}"` : "text";
      step.title = `Enter ${label}`;
    } else if (raw.action === "navigation") {
      step.title = `Navigate to ${pageName(step.url)}`;
    } else {
      step.title = step.action;
    }
  }
}

// Pass 4: Re-index
function reindex(steps: WorkflowStep[]): void {
  steps.forEach((s, i) => (s.index = i));
}

export function postprocess(rawSteps: RecordedStep[]): WorkflowStep[] {
  const deduped = deduplicateClicks(rawSteps);
  const merged = mergeClickNav(deduped);
  generateTitles(merged);
  reindex(merged);
  return merged;
}
