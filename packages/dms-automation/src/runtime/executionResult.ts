import type { RunLog } from "../types/runLog";

export interface ExecutionResult {
  status: "ok" | "failed";
  errorMessage?: string;
  logs: RunLog;
}
