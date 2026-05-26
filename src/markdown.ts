import * as fs from "fs";
import * as path from "path";
import { WorkflowStep } from "./types";
import { pageName } from "./postprocess";

interface MarkdownOptions {
  name: string;
  startUrl: string;
  steps: WorkflowStep[];
  outputDir: string;
}

function toTitleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildPath(steps: WorkflowStep[]): string {
  const names: string[] = [];
  for (const step of steps) {
    const name = pageName(step.url);
    if (names.length === 0 || names[names.length - 1] !== name) {
      names.push(name);
    }
  }
  return names.join(" → ");
}

export async function generateMarkdown(options: MarkdownOptions): Promise<string> {
  const { name, startUrl, steps, outputDir } = options;
  const title = toTitleCase(name);
  const timestamp = new Date().toISOString();
  const workflowSteps = steps.filter((s) => s.rawSteps[0].action !== "start");

  const lines: string[] = [
    `# ${title}`,
    "",
    `**Start URL:** ${startUrl}`,
    `**Captured:** ${timestamp}`,
    `**Steps:** ${workflowSteps.length}`,
    "",
    `**Path:** ${buildPath(steps)}`,
    "",
    "---",
    "",
  ];

  // Start step
  const startStep = steps.find((s) => s.rawSteps[0].action === "start");
  if (startStep && startStep.screenshotPath) {
    lines.push(`## Start: ${pageName(startStep.url)}`);
    lines.push("");
    appendNarration(lines, startStep);
    lines.push(`![Start](${startStep.screenshotPath})`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Workflow steps
  let stepNum = 1;
  for (const step of workflowSteps) {
    lines.push(`## Step ${stepNum}: ${step.title}`);
    lines.push("");

    // Action + result line
    if (step.result) {
      lines.push(`${step.action} → ${step.result}`);
    } else {
      lines.push(step.action);
    }
    lines.push("");

    if (step.value) {
      lines.push(`**Value:** ${step.value}`);
      lines.push("");
    }

    appendNarration(lines, step);

    if (step.screenshotPath) {
      lines.push(`![Step ${stepNum}](${step.screenshotPath})`);
      lines.push("");
    }

    // Technical details in collapsed block
    if (step.selector || step.url) {
      lines.push("<details><summary>Technical details</summary>");
      lines.push("");
      if (step.selector) {
        lines.push(`- **Element:** \`${step.selector}\``);
      }
      lines.push(`- **URL:** ${step.url}`);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }

    lines.push("---");
    lines.push("");
    stepNum++;
  }

  const content = lines.join("\n");
  const readmePath = path.join(outputDir, "README.md");
  await fs.promises.writeFile(readmePath, content, "utf-8");
  return readmePath;
}

function appendNarration(lines: string[], step: WorkflowStep): void {
  const n = step.narration;
  if (!n) return;
  if (n.transcript) {
    lines.push(`> ${n.transcript.replace(/\n/g, "\n> ")}`);
    lines.push("");
  }
  const seconds = (n.durationMs / 1000).toFixed(1);
  lines.push(`🎧 [Audio narration](${n.audioPath}) · ${seconds}s`);
  lines.push("");
}
