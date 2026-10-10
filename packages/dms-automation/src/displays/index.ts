import {
  ColumnDisplay,
  RegisterDisplay,
} from "@antelopejs/interface-dms/base/table-view";

/** Options of the run strip: how many runs it draws. */
export interface LastRunsDisplayOptions {
  limit?: number;
}

/**
 * The last runs of a procedure as a strip of bars, green or red, oldest
 * first. Reads a list of statuses (`ok` / `failed`).
 */
@RegisterDisplay("automation:last-runs")
export class LastRunsDisplay extends ColumnDisplay<LastRunsDisplayOptions> {}
