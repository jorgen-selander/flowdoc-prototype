import { Page, BrowserContext } from "playwright";
import { BrowserEvent, RecordedStep } from "./types";
import { takeScreenshot } from "./screenshot";

const INJECTED_SCRIPT = `
(function() {
  if (window.__flowdoc_injected) return;
  window.__flowdoc_injected = true;

  // --- Selector generation ---
  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
    if (el.getAttribute('name')) return el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';
    if (el.getAttribute('aria-label')) return '[aria-label="' + el.getAttribute('aria-label') + '"]';
    // CSS path fallback
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      let tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          tag += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(tag);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getLabel(el) {
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) return label.textContent.trim();
    }
    const closest = el.closest('label');
    if (closest) return closest.textContent.trim();
    return '';
  }

  // --- Click handler ---
  document.addEventListener('click', function(e) {
    const el = e.target;
    if (!el || !el.tagName) return;
    const text = (el.innerText || '').trim().substring(0, 80);
    window.__flowdoc_report(JSON.stringify({
      type: 'click',
      selector: getSelector(el),
      tagName: el.tagName.toLowerCase(),
      innerText: text,
      href: el.href || el.closest('a')?.href || '',
      url: location.href,
      timestamp: Date.now()
    }));
  }, true);

  // --- Input handler with debounce ---
  const debounceTimers = new WeakMap();
  document.addEventListener('input', function(e) {
    const el = e.target;
    if (!el || !el.tagName) return;
    const existing = debounceTimers.get(el);
    if (existing) clearTimeout(existing);
    debounceTimers.set(el, setTimeout(function() {
      const isPassword = el.type === 'password';
      window.__flowdoc_report(JSON.stringify({
        type: 'input',
        selector: getSelector(el),
        tagName: el.tagName.toLowerCase(),
        inputType: el.type || '',
        value: isPassword ? '********' : (el.value || '').substring(0, 200),
        placeholder: el.placeholder || '',
        label: getLabel(el),
        url: location.href,
        timestamp: Date.now()
      }));
    }, 500));
  }, true);

  // --- Navigation handler ---
  let lastUrl = location.href;
  function checkNavigation() {
    if (location.href !== lastUrl) {
      const prev = lastUrl;
      lastUrl = location.href;
      window.__flowdoc_report(JSON.stringify({
        type: 'navigation',
        selector: '',
        tagName: '',
        url: location.href,
        timestamp: Date.now()
      }));
    }
  }

  window.addEventListener('popstate', checkNavigation);
  window.addEventListener('hashchange', checkNavigation);

  const origPushState = history.pushState;
  history.pushState = function() {
    origPushState.apply(this, arguments);
    checkNavigation();
  };
  const origReplaceState = history.replaceState;
  history.replaceState = function() {
    origReplaceState.apply(this, arguments);
    checkNavigation();
  };
})();
`;

export class Recorder {
  private steps: RecordedStep[] = [];
  private outputDir: string;
  private screenshotLock: Promise<void> = Promise.resolve();
  private pendingCount = 0;
  private stopped = false;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  async setupPage(page: Page): Promise<void> {
    await page.exposeFunction("__flowdoc_report", (jsonStr: string) => {
      if (this.stopped) return;
      const event: BrowserEvent = JSON.parse(jsonStr);
      this.handleBrowserEvent(event, page);
    });
    // addInitScript runs on future navigations
    await page.addInitScript(INJECTED_SCRIPT);
    // Also inject into the already-loaded page
    await page.evaluate(INJECTED_SCRIPT);
  }

  setupContext(context: BrowserContext): void {
    context.on("page", async (newPage) => {
      try {
        await this.setupPage(newPage);
      } catch {
        // Page may have closed before setup completed
      }
    });
  }

  async recordStartStep(page: Page, url: string): Promise<void> {
    const index = this.steps.length;
    const filename = `step-${String(index).padStart(3, "0")}.png`;
    const screenshotPath = await takeScreenshot(page, this.outputDir, filename);
    const step: RecordedStep = {
      index,
      timestamp: Date.now(),
      action: "start",
      description: `Opened ${url}`,
      url,
      selector: "",
      screenshotPath,
    };
    this.steps.push(step);
    console.log(`  [${index}] ${step.description}`);
  }

  private handleBrowserEvent(event: BrowserEvent, page: Page): void {
    this.pendingCount++;
    this.screenshotLock = this.screenshotLock.then(async () => {
      try {
        if (this.stopped) return;
        // Wait briefly for DOM to settle after the event
        await new Promise((r) => setTimeout(r, 300));
        if (this.stopped) return;

        const index = this.steps.length;
        const filename = `step-${String(index).padStart(3, "0")}.png`;
        let screenshotPath: string;
        try {
          screenshotPath = await takeScreenshot(page, this.outputDir, filename);
        } catch {
          // Page may have navigated or closed
          screenshotPath = "";
        }

        const description = this.describeEvent(event);
        const step: RecordedStep = {
          index,
          timestamp: event.timestamp,
          action: event.type,
          description,
          url: event.url,
          selector: event.selector,
          value: event.value,
          screenshotPath,
        };
        this.steps.push(step);
        console.log(`  [${index}] ${description}`);
      } finally {
        this.pendingCount--;
      }
    });
  }

  private describeEvent(event: BrowserEvent): string {
    switch (event.type) {
      case "click": {
        const tag = event.tagName;
        const text = event.innerText
          ? `'${event.innerText.substring(0, 40)}'`
          : "";
        if (tag === "a" && event.href) {
          return `Clicked link ${text}`.trim();
        }
        if (tag === "button" || tag === "input") {
          return `Clicked ${tag} ${text}`.trim();
        }
        return `Clicked ${tag} ${text}`.trim();
      }
      case "input": {
        const label = event.label || event.placeholder || event.selector;
        const val =
          event.inputType === "password" ? "********" : `'${event.value}'`;
        return `Typed ${val} in '${label}'`;
      }
      case "navigation":
        return `Navigated to ${event.url}`;
      default:
        return `${event.type} on ${event.selector}`;
    }
  }

  stop(): void {
    this.stopped = true;
  }

  async waitForPending(): Promise<void> {
    await this.screenshotLock;
  }

  getSteps(): RecordedStep[] {
    return [...this.steps];
  }
}
