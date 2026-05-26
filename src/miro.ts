import { WorkflowGraph, WorkflowNode } from "./types";

interface MiroOptions {
  graph: WorkflowGraph;
  boardId: string;
  accessToken: string;
}

const MIRO_API = "https://api.miro.com";
const SHAPE_WIDTH = 340;
const SHAPE_HEIGHT = 140;

export async function generateMiro(options: MiroOptions): Promise<string> {
  const { graph, boardId, accessToken } = options;

  if (graph.nodes.length === 0) {
    console.log("No workflow nodes to push.");
    return boardUrl(boardId);
  }

  console.log(`\nCreating ${graph.nodes.length} shape(s) on board ${boardId}...`);

  const miroIdByNodeId = new Map<string, string>();
  for (const node of graph.nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const shape = await createShape(accessToken, boardId, node, x, y);
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
): Promise<{ id: string }> {
  const body = shapeBody(node, x, y);
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

function shapeBody(node: WorkflowNode, x: number, y: number): object {
  const content = node.isStart
    ? `<p><strong>Start:</strong> ${escapeHtml(stripStartPrefix(node.title))}</p>`
    : `<p><strong>${node.sourceStepIndex}.</strong> ${escapeHtml(node.title)}</p>`;

  return {
    data: {
      shape: "round_rectangle",
      content,
    },
    style: {
      fillColor: "#ffffff",
      fillOpacity: "1.0",
      borderColor: node.isStart ? "#4caf50" : "#2d9bf0",
      borderWidth: "4",
      borderOpacity: "1.0",
      borderStyle: "normal",
      color: "#1a1a1a",
      fontFamily: "open_sans",
      fontSize: "20",
      textAlign: "center",
      textAlignVertical: "middle",
    },
    position: { x, y, origin: "center" },
    geometry: { width: SHAPE_WIDTH, height: SHAPE_HEIGHT },
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
