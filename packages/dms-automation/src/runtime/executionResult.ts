import type { RunLog } from "../types/runLog";

export interface ExecutionResult {
  /** `cancelled`: a module one of its steps relies on went away mid-run. */
  status: "ok" | "failed" | "cancelled";
  errorMessage?: string;
  /** Node whose failure ended the run, when one did. */
  failedNodeId?: string;
  logs: RunLog;
}
