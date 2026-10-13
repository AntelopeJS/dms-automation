import {
  ColumnDisplay,
  DefaultDisplays,
  RegisterDisplay,
} from "@antelopejs/interface-dms/base/table-view";

/** Options of the run strip. */
export interface LastRunsDisplayOptions {
  /** How many runs it draws. */
  limit?: number;
  /** Row field listing the runs, oldest first. */
  runsField: string;
  /** The page of a run, `{runId}` filled from the bar's run. */
  runUrl?: string;
  /** Text under an empty strip. `$`-prefixed: an i18n key. */
  emptyLabel?: string;
}

/**
 * The last runs of a procedure as a strip of bars, green or red, oldest
 * first, each a link to its run, over the column's date (the last run's start)
 * as the distance to now. The runs are `{ runId, status, startedAt,
 * errorMessage }`.
 */
@RegisterDisplay("automation:last-runs")
export class LastRunsDisplay extends ColumnDisplay<LastRunsDisplayOptions> {}

/** Options of a procedure's name: the identity cell's, and the page it opens. */
export interface ProcedureLinkDisplayOptions
  extends DefaultDisplays.IdentityDisplayOptions {
  /** The page the name opens, `{field}` filled from the row. */
  url: string;
}

/**
 * The identity cell of a procedure (icon, name, description) as a link, so
 * the name opens it with a click, a middle-click or the keyboard.
 */
@RegisterDisplay("automation:procedure-link")
export class ProcedureLinkDisplay extends ColumnDisplay<ProcedureLinkDisplayOptions> {}
