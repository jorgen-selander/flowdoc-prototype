export interface CaptureOptions {
  url: string;
  name: string;
  outputDir: string;
  debug: boolean;
  audio: boolean;
  mic?: string;
}

export type ActionType = "click" | "input" | "navigation" | "start";

export interface RecordedStep {
  index: number;
  timestamp: number;
  action: ActionType;
  description: string;
  url: string;
  selector: string;
  value?: string;
  screenshotPath: string;
}

export interface Narration {
  audioPath: string;
  durationMs: number;
  recordedAt: string;
  transcript?: string;
  audioMtime?: string;
}

export interface WorkflowStep {
  index: number;
  title: string;
  action: string;
  result: string;
  url: string;
  selector: string;
  value?: string;
  screenshotPath: string;
  rawSteps: RecordedStep[];
  narration?: Narration;
}

export interface BrowserEvent {
  type: "click" | "input" | "navigation";
  selector: string;
  tagName: string;
  innerText?: string;
  inputType?: string;
  value?: string;
  placeholder?: string;
  label?: string;
  href?: string;
  url: string;
  timestamp: number;
}

export interface WorkflowNode {
  id: string;
  title: string;
  url: string;
  isStart: boolean;
  actionType: ActionType;
  sourceFlow: string;
  sourceStepIndex: number;
  transcript?: string;
  x?: number;
  y?: number;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
