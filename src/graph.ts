import {
  ActionType,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowStep,
} from "./types";

const DEPTH_STRIDE = 450;
const LANE_STRIDE = 260;

interface BranchInput {
  name: string;
  steps: WorkflowStep[];
}

export function captionFor(action: ActionType): string | undefined {
  switch (action) {
    case "click":
      return "click";
    case "input":
      return "type";
    case "navigation":
      return "navigate";
    default:
      return undefined;
  }
}

export function stepsToGraph(steps: WorkflowStep[], flowName: string): WorkflowGraph {
  const nodes: WorkflowNode[] = steps.map((step) => {
    const raw = step.rawSteps[0];
    const action: ActionType = (raw?.action ?? "click") as ActionType;
    return {
      id: `${flowName}:${step.index}`,
      title: step.title,
      url: step.url,
      isStart: raw?.action === "start",
      actionType: action,
      sourceFlow: flowName,
      sourceStepIndex: step.index,
      transcript: step.narration?.transcript,
    };
  });

  const edges: WorkflowEdge[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const toStep = steps[i + 1];
    edges.push({
      id: `${flowName}:e:${i}`,
      from: `${flowName}:${steps[i].index}`,
      to: `${flowName}:${toStep.index}`,
      label: captionFor((toStep.rawSteps[0]?.action ?? "click") as ActionType),
    });
  }

  return { nodes, edges };
}

function stepsMatch(a: WorkflowStep, b: WorkflowStep): boolean {
  const aAction = a.rawSteps[0]?.action;
  const bAction = b.rawSteps[0]?.action;
  return aAction === bAction && a.url === b.url && a.selector === b.selector;
}

export function mergeGraphs(
  main: WorkflowGraph,
  mainSteps: WorkflowStep[],
  branches: BranchInput[],
): WorkflowGraph {
  const merged: WorkflowGraph = {
    nodes: [...main.nodes],
    edges: [...main.edges],
  };

  for (const branch of branches) {
    if (branch.steps.length === 0) {
      console.warn(`  ⚠ branch "${branch.name}" has no steps — skipping.`);
      continue;
    }

    let divergence = 0;
    while (
      divergence < mainSteps.length &&
      divergence < branch.steps.length &&
      stepsMatch(mainSteps[divergence], branch.steps[divergence])
    ) {
      divergence++;
    }

    if (divergence === 0) {
      console.warn(
        `  ⚠ branch "${branch.name}" shares no prefix with main (different start) — skipping.`,
      );
      continue;
    }

    if (divergence >= branch.steps.length) {
      console.warn(
        `  ⚠ branch "${branch.name}" is fully contained in main — nothing to add.`,
      );
      continue;
    }

    const branchGraph = stepsToGraph(branch.steps, branch.name);
    const branchNodesFromDivergence = branchGraph.nodes.filter(
      (n) => n.sourceStepIndex >= divergence,
    );
    const branchEdgesFromDivergence = branchGraph.edges.filter((e) => {
      const fromIdx = parseInt(e.from.split(":")[1], 10);
      return fromIdx >= divergence;
    });

    const forkFromMain = `main:${mainSteps[divergence - 1].index}`;
    const forkToBranch = `${branch.name}:${branch.steps[divergence].index}`;
    const forkLabel = captionFor(
      (branch.steps[divergence].rawSteps[0]?.action ?? "click") as ActionType,
    );

    merged.nodes.push(...branchNodesFromDivergence);
    merged.edges.push({
      id: `fork:${branch.name}:${divergence}`,
      from: forkFromMain,
      to: forkToBranch,
      label: forkLabel,
    });
    merged.edges.push(...branchEdgesFromDivergence);
  }

  return merged;
}

export function layoutGraph(graph: WorkflowGraph): WorkflowGraph {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const childrenByParent = new Map<string, string[]>();
  const parentByChild = new Map<string, string>();

  for (const edge of graph.edges) {
    const list = childrenByParent.get(edge.from) ?? [];
    list.push(edge.to);
    childrenByParent.set(edge.from, list);
    if (!parentByChild.has(edge.to)) {
      parentByChild.set(edge.to, edge.from);
    }
  }

  const start = graph.nodes.find((n) => n.isStart) ?? graph.nodes[0];
  if (!start) return graph;

  const depth = new Map<string, number>();
  depth.set(start.id, 0);
  const queue: string[] = [start.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const childId of childrenByParent.get(id) ?? []) {
      if (!depth.has(childId)) {
        depth.set(childId, d + 1);
        queue.push(childId);
      }
    }
  }

  const branchFlows = Array.from(
    new Set(graph.nodes.filter((n) => n.sourceFlow !== "main").map((n) => n.sourceFlow)),
  );
  const laneByFlow = new Map<string, number>();
  laneByFlow.set("main", 0);
  branchFlows.forEach((flow, i) => {
    const k = i + 1;
    const sign = k % 2 === 1 ? -1 : 1;
    const magnitude = Math.ceil(k / 2);
    laneByFlow.set(flow, sign * magnitude * LANE_STRIDE);
  });

  for (const node of graph.nodes) {
    const d = depth.get(node.id) ?? 0;
    node.x = d * DEPTH_STRIDE;
    node.y = laneByFlow.get(node.sourceFlow) ?? 0;
  }

  return graph;
}
