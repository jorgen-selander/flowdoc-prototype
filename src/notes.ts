import * as fs from "fs";
import * as path from "path";
import { WorkflowStep } from "./types";

interface NotesOptions {
  name: string;
  steps: WorkflowStep[];
  outputDir: string;
}

function toTitleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function generateNotes(options: NotesOptions): Promise<string> {
  const { name, steps, outputDir } = options;
  const title = toTitleCase(name);
  const workflowSteps = steps.filter((s) => s.rawSteps[0].action !== "start");

  const lines: string[] = [`# ${title} — Notes`, ""];

  let stepNum = 1;
  for (const step of workflowSteps) {
    lines.push(`## Step ${stepNum}: ${step.title}`);
    lines.push(`**URL:** ${step.url}`);
    lines.push("");
    lines.push("**Intent:**");
    lines.push("");
    lines.push("**Notes:**");
    lines.push("");
    lines.push("---");
    lines.push("");
    stepNum++;
  }

  const content = lines.join("\n");
  const notesPath = path.join(outputDir, "notes-template.md");
  await fs.promises.writeFile(notesPath, content, "utf-8");
  return notesPath;
}
