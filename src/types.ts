export interface CaptureOptions {
  url: string;
  name: string;
  outputDir: string;
  debug: boolean;
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
