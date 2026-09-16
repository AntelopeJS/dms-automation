import { type ListEnvelope, unwrapList } from "../utils/automation";

export type LogLevel = "info" | "warn" | "error";

export interface FireNode {
  id: string;
  parentFireId: string | null;
  sourceNodeId: string;
  port: string | null;
  ts: number;
  /**
   * Monotonic per-run sequence number, shared with LogEntry.seq.
   * Tiebreaker when several events share the same millisecond ts.
   */
  seq: number;
  iteration?: number;
  closedAt?: number;
}

export interface LogEntry {
  fireId: string;
  ts: number;
  seq: number;
  level: LogLevel;
  source: "log" | "exec";
  nodeId?: string;
  nodeKind?: string;
  message: string;
  value?: unknown;
}

export interface RunLog {
  fires: FireNode[];
  entries: LogEntry[];
}

export interface RunSummary {
  _id: string;
  procedureId: string;
  startedAt: string;
  endedAt?: string | null;
  status: string;
  errorMessage?: string | null;
  triggerNodeId?: string;
  triggerPayload?: string;
}

export interface RunDetail extends RunSummary {
  logs?: RunLog;
}

export interface ProcedureRef {
  _id: string;
  name: string;
}

export function useAutomationRuns() {
  const { $authFetch } = useAuthFetch();

  return {
    async getRun(id: string): Promise<RunDetail> {
      return await $authFetch<RunDetail>(`/api/automation/runs/${id}`);
    },

    async listProcedures(): Promise<ProcedureRef[]> {
      const data = await $authFetch<
        ProcedureRef[] | ListEnvelope<ProcedureRef>
      >("/api/automation/procedures");
      return unwrapList<ProcedureRef>(data).map((p) => ({
        _id: p._id,
        name: p.name,
      }));
    },
  };
}
