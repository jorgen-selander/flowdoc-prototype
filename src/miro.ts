import { WorkflowStep } from "./types";

interface MiroOptions {
  steps: WorkflowStep[];
  boardId: string;
  accessToken: string;
}

interface CreatedShape {
  id: string;
  stepIndex: number;
}

const MIRO_API = "https://api.miro.com";
const SHAPE_WIDTH = 340;
const SHAPE_HEIGHT = 140;
const SHAPE_SPACING_X = 450;

export async function generateMiro(options: MiroOptions): Promise<string> {
  const { steps, boardId, accessToken } = options;
  const ordered = [...steps].sort((a, b) => a.index - b.index);

  if (ordered.length === 0) {
    console.log("No workflow steps to push.");
    return boardUrl(boardId);
  }

  console.log(`\nCreating ${ordered.length} shape(s) on board ${boardId}...`);

  const created: CreatedShape[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const step = ordered[i];
    const x = i * SHAPE_SPACING_X;
    const shape = await createShape(accessToken, boardId, step, i, x, 0);
    created.push({ id: shape.id, stepIndex: i });
    console.log(`  [${i}] shape ${shape.id} "${step.title}"`);
  }

  if (created.length > 1) {
    console.log(`\nCreating ${created.length - 1} connector(s)...`);
    for (let i = 0; i < created.length - 1; i++) {
      const fromId = created[i].id;
      const toId = created[i + 1].id;
      const caption = captionFor(ordered[i + 1]);
      const connector = await createConnector(accessToken, boardId, fromId, toId, caption);
      const tag = caption ? ` "${caption}"` : "";
      console.log(`  [${i}→${i + 1}] connector ${connector.id}${tag}`);
    }
  }

  const url = boardUrl(boardId);
  console.log(`\nDone. ${created.length} shape(s), ${Math.max(0, created.length - 1)} connector(s).`);
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
  step: WorkflowStep,
  displayIndex: number,
  x: number,
  y: number,
): Promise<{ id: string }> {
  const body = shapeBody(step, displayIndex, x, y);
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

function shapeBody(step: WorkflowStep, displayIndex: number, x: number, y: number): object {
  const isStart = step.rawSteps[0]?.action === "start";
  const content = isStart
    ? `<p><strong>Start:</strong> ${escapeHtml(stripStartPrefix(step.title))}</p>`
    : `<p><strong>${displayIndex}.</strong> ${escapeHtml(step.title)}</p>`;

  return {
    data: {
      shape: "round_rectangle",
      content,
    },
    style: {
      fillColor: "#ffffff",
      fillOpacity: "1.0",
      borderColor: isStart ? "#4caf50" : "#2d9bf0",
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

function captionFor(step: WorkflowStep): string | undefined {
  const action = step.rawSteps[0]?.action;
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
