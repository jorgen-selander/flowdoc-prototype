import * as fs from "fs";
import * as path from "path";
import { WorkflowStep } from "./types";
import { pageName } from "./postprocess";

interface MermaidOptions {
  steps: WorkflowStep[];
  outputDir: string;
}

export async function generateMermaid(options: MermaidOptions): Promise<string> {
  const { steps, outputDir } = options;

  // Build nodes from unique page URLs
  const nodes: { id: string; label: string }[] = [];
  let nodeIndex = 0;

  for (const step of steps) {
    const label = pageName(step.url);
    if (nodes.length === 0 || nodes[nodes.length - 1].label !== label) {
      nodes.push({ id: `S${nodeIndex}`, label });
      nodeIndex++;
    }
  }

  const lines: string[] = ["flowchart TD"];
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    lines.push(`    ${from.id}["${from.label}"] --> ${to.id}["${to.label}"]`);
  }

  // Handle single-node case
  if (nodes.length === 1) {
    lines.push(`    ${nodes[0].id}["${nodes[0].label}"]`);
  }

  const content = lines.join("\n") + "\n";
  const mermaidPath = path.join(outputDir, "flow.mmd");
  await fs.promises.writeFile(mermaidPath, content, "utf-8");
  return mermaidPath;
}
