import { WorkflowGraph, WorkflowNode } from "./types";

interface MiroOptions {
  graph: WorkflowGraph;
  boardId: string;
  accessToken: string;
}

const MIRO_API = "https://api.miro.com";

// Unikum brand palette
const UNIKUM = {
  yellow: "#FFDB1C",
  blue: "#0C69D2",
  green: "#58B456",
  lightBlue: "#C7DDF4",
  dark: "#252525",
  white: "#ffffff",
};

interface ShapeStyle {
  shape: string;
  fillColor: string;
  textColor: string;
  fontSize: string;
  width: number;
  height: number;
}

function styleFor(node: WorkflowNode, isFork: boolean): ShapeStyle {
  // Start step → yellow circle
  if (node.isStart) {
    return {
      shape: "circle",
      fillColor: UNIKUM.yellow,
      textColor: UNIKUM.dark,
      fontSize: "16",
      width: 180,
      height: 180,
    };
  }
  // Fork point (has 2+ outgoing edges) → green diamond
  if (isFork) {
    return {
      shape: "rhombus",
      fillColor: UNIKUM.green,
      textColor: UNIKUM.white,
      fontSize: "18",
      width: 280,
      height: 200,
    };
  }
  // Landed on a page → light blue rectangle
  if (node.actionType === "navigation" || (node.result && node.actionType === "click")) {
    return {
      shape: "rectangle",
      fillColor: UNIKUM.lightBlue,
      textColor: UNIKUM.dark,
      fontSize: "20",
      width: 340,
      height: 140,
    };
  }
  // Pure user action (click without nav, input) → blue rounded rectangle
  return {
    shape: "round_rectangle",
    fillColor: UNIKUM.blue,
    textColor: UNIKUM.white,
    fontSize: "20",
    width: 340,
    height: 140,
  };
}

export async function generateMiro(options: MiroOptions): Promise<string> {
  const { graph, boardId, accessToken } = options;

  if (graph.nodes.length === 0) {
    console.log("No workflow nodes to push.");
    return boardUrl(boardId);
  }

  console.log(`\nCreating ${graph.nodes.length} shape(s) on board ${boardId}...`);

  // A node is a "fork" if it has 2+ outgoing edges — that's the branch decision point.
  const outgoingByFrom = new Map<string, number>();
  for (const edge of graph.edges) {
    outgoingByFrom.set(edge.from, (outgoingByFrom.get(edge.from) ?? 0) + 1);
  }

  const miroIdByNodeId = new Map<string, string>();
  for (const node of graph.nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const isFork = (outgoingByFrom.get(node.id) ?? 0) > 1;
    const shape = await createShape(accessToken, boardId, node, x, y, isFork);
    miroIdByNodeId.set(node.id, shape.id);
    console.log(`  [${node.id}] shape ${shape.id} "${node.title}"`);
  }

  if (graph.edges.length > 0) {
    console.log(`\nCreating ${graph.edges.length} connector(s)...`);
    for (const edge of graph.edges) {
      const fromMiroId = miroIdByNodeId.get(edge.from);
      const toMiroId = miroIdByNodeId.get(edge.to);
      if (!fromMiroId || !toMiroId) {
        console.warn(`  ⚠ skipping edge ${edge.id}: unresolved node reference`);
        continue;
      }
      const connector = await createConnector(
        accessToken,
        boardId,
        fromMiroId,
        toMiroId,
        edge.label,
      );
      const tag = edge.label ? ` "${edge.label}"` : "";
      console.log(`  [${edge.from} → ${edge.to}] connector ${connector.id}${tag}`);
    }
  }

  const url = boardUrl(boardId);
  console.log(
    `\nDone. ${graph.nodes.length} shape(s), ${graph.edges.length} connector(s).`,
  );
  console.log(`Board: ${url}`);
  return url;
}

async function miroFetch<T>(
  token: string,
  method: string,
  path: string,
  body?: object,
): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(`${MIRO_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Miro API ${method} ${path} failed: ${res.status} ${res.statusText}\n${text}`,
    );
  }

  await maybeSleepForRateLimit(res.headers);
  const data = text ? (JSON.parse(text) as T) : ({} as T);
  return { data, headers: res.headers };
}

async function maybeSleepForRateLimit(headers: Headers): Promise<void> {
  const remaining = Number(headers.get("X-RateLimit-Remaining"));
  const limit = Number(headers.get("X-RateLimit-Limit"));
  if (Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0) {
    if (remaining / limit < 0.1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function createShape(
  token: string,
  boardId: string,
  node: WorkflowNode,
  x: number,
  y: number,
  isFork: boolean,
): Promise<{ id: string }> {
  const body = shapeBody(node, x, y, isFork);
  const { data } = await miroFetch<{ id: string }>(
    token,
    "POST",
    `/v2/boards/${encodeURIComponent(boardId)}/shapes`,
    body,
  );
  return { id: data.id };
}

async function createConnector(
  token: string,
  boardId: string,
  startId: string,
  endId: string,
  caption?: string,
): Promise<{ id: string }> {
  const body = connectorBody(startId, endId, caption);
  const { data } = await miroFetch<{ id: string }>(
    token,
    "POST",
    `/v2/boards/${encodeURIComponent(boardId)}/connectors`,
    body,
  );
  return { id: data.id };
}

function shapeBody(node: WorkflowNode, x: number, y: number, isFork: boolean): object {
  const style = styleFor(node, isFork);
  const titleLine = node.isStart
    ? `<p><strong>Start</strong></p><p>${escapeHtml(stripStartPrefix(node.title))}</p>`
    : `<p><strong>${node.sourceStepIndex}.</strong> ${escapeHtml(node.title)}</p>`;
  const transcriptLine = node.transcript
    ? `<p><em>${escapeHtml(truncate(node.transcript, 220))}</em></p>`
    : "";
  const content = titleLine + transcriptLine;

  return {
    data: {
      shape: style.shape,
      content,
    },
    style: {
      fillColor: style.fillColor,
      fillOpacity: "1.0",
      borderColor: style.fillColor,
      borderWidth: "2",
      borderOpacity: "0.0",
      borderStyle: "normal",
      color: style.textColor,
      fontFamily: "open_sans",
      fontSize: style.fontSize,
      textAlign: "center",
      textAlignVertical: "middle",
    },
    position: { x, y, origin: "center" },
    geometry: { width: style.width, height: style.height },
  };
}

function connectorBody(startId: string, endId: string, caption?: string): object {
  const body: Record<string, unknown> = {
    startItem: { id: startId },
    endItem: { id: endId },
    shape: "elbowed",
    style: {
      startStrokeCap: "none",
      endStrokeCap: "arrow",
      strokeColor: "#1a1a1a",
      strokeWidth: "2",
      strokeStyle: "normal",
      fontSize: "14",
      textOrientation: "horizontal",
    },
  };
  if (caption) {
    body.captions = [{ content: escapeHtml(caption) }];
  }
  return body;
}

function stripStartPrefix(title: string): string {
  return title.replace(/^Start:\s*/, "");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function boardUrl(boardId: string): string {
  return `https://miro.com/app/board/${encodeURIComponent(boardId)}/`;
}
