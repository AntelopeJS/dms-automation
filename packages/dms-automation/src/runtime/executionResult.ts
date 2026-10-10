import type { RunLog } from "../types/runLog";

export interface ExecutionResult {
  status: "ok" | "failed";
  errorMessage?: string;
  /** Node whose failure ended the run, when one did. */
  failedNodeId?: string;
  logs: RunLog;
}
