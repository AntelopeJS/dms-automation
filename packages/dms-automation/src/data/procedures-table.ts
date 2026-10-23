import {
  Controller,
  HTTPResult,
  JSONBody,
  MultiParameter,
  Parameter,
} from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import { Parameters } from "@antelopejs/interface-data-api/components";
import {
  Access,
  AccessMode,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import type { BlockText } from "@antelopejs/interface-dms/base/types";
import { Searchable } from "@antelopejs/interface-dms/base/searchable";
import {
  type CellSublineValue,
  Column,
  DefaultDisplays,
} from "@antelopejs/interface-dms/base/table-view";
import { ProcedureModel } from "../db/models/procedure.model";
import {
  getProcedureSummary,
  getProceduresSummary,
  type ProcedureSummaryRow,
} from "../db/models/stats.model";
import { Procedure } from "../db/tables/procedure.table";
import { LastRunsDisplay, ProcedureLinkDisplay } from "../displays";
import { BUILDER_URL, TRACE_URL } from "../pages/shared";
import { builtinTriggers } from "../runtime/builtins/triggers";
import { stateRank } from "../stats/health";
import { subscriptions } from "../runtime/subscriptions";
import { DATABASE_NAME } from "../types/constants";

// The Procedures list is a computed aggregate (state, last runs, success rate
// over 7 days) rather than plain table columns, so the TableView is backed by
// custom `list`/`count`/`countBatch` routes that compute the summary and apply
// the table's search, status filter, sort and pagination in memory. `delete`
// also tears down the procedure's runtime subscriptions. Module pages are the
// platform owner's alone, so every route is owner-only, like the module's API.

/**
 * A query-string value as text: the API hands a parameter sent without a
 * value (`?search`, an emptied search field) in as `true`.
 */
function queryText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** Text as the search compares it: lower case, accents dropped. */
function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

interface ColumnFilter {
  mode: string;
  values: string[];
}

function parseFilter(raw: unknown): ColumnFilter | undefined {
  const text = queryText(raw);
  if (!text) return undefined;
  const idx = text.indexOf(":");
  const [mode, value] =
    idx < 0 ? ["is", text] : [text.slice(0, idx), text.slice(idx + 1)];
  const values = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length ? { mode, values } : undefined;
}

const NEGATED_MODES = new Set(["is_not", "exclude"]);

/** Whether a row holding these values passes a column filter. */
function passes(
  values: readonly string[],
  filter: ColumnFilter | undefined,
): boolean {
  if (!filter) return true;
  const hit = values.some((v) => filter.values.includes(v));
  return NEGATED_MODES.has(filter.mode) ? !hit : hit;
}

/**
 * What the search reads in a row: its name and description, the paths and
 * schedules of its triggers, and its last error.
 */
function searchedText(row: ProcedureSummaryRow): string {
  return folded(
    [
      row.name,
      row.description,
      row.lastError ?? "",
      ...row.triggers.flatMap((t) => [t.path ?? "", t.cron ?? ""]),
    ].join("\n"),
  );
}

/** The table's query: its search and its column filters, raw. */
export interface ProceduresQuery {
  search?: unknown;
  filter_status?: unknown;
  filter_triggerTypes?: unknown;
}

/** The rows the search and the status and trigger filters keep. */
export function applyQuery(
  rows: ProcedureSummaryRow[],
  query: ProceduresQuery,
): ProcedureSummaryRow[] {
  const q = folded(queryText(query.search));
  const status = parseFilter(query.filter_status);
  const triggerTypes = parseFilter(query.filter_triggerTypes);
  return rows.filter(
    (r) =>
      (!q || searchedText(r).includes(q)) &&
      passes([r.status], status) &&
      passes(r.triggerTypes, triggerTypes),
  );
}

const SORTABLE_KEYS = new Set<keyof ProcedureSummaryRow>([
  "name",
  "trigger",
  "status",
  "lastRunAt",
  "successRate",
  "avgDurationMs",
  "runs",
]);

type SortValue = ProcedureSummaryRow[keyof ProcedureSummaryRow];

/** Text a row's value sorts by: its JSON for an object (a trigger summary). */
function sortText(value: SortValue): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function compareValues(a: SortValue, b: SortValue, dir: number): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last, irrespective of direction
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
  return sortText(a).localeCompare(sortText(b)) * dir;
}

/**
 * By state, the ones that need attention first (last with `dir` -1), then by
 * name.
 */
function byState(
  a: ProcedureSummaryRow,
  b: ProcedureSummaryRow,
  dir = 1,
): number {
  return (
    (stateRank(a.status) - stateRank(b.status)) * dir ||
    a.name.localeCompare(b.name)
  );
}

export function sortRows(
  rows: ProcedureSummaryRow[],
  sortKey?: unknown,
  sortDirection?: unknown,
): ProcedureSummaryRow[] {
  const k = queryText(sortKey) as keyof ProcedureSummaryRow;
  if (!SORTABLE_KEYS.has(k)) return [...rows].sort((a, b) => byState(a, b));
  const dir = sortDirection === "desc" ? -1 : 1;
  // A state sorts by severity, not by its name.
  if (k === "status") return [...rows].sort((a, b) => byState(a, b, dir));
  return [...rows].sort((a, b) => compareValues(a[k], b[k], dir));
}

// Parse a query-string integer, falling back when it is missing or not a finite
// number (so a malformed `?limit=abc` doesn't slice to an empty page).
function toInt(raw: unknown, fallback: number, min: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

const DEFAULT_PAGE_SIZE = 10;

interface CountBatchBody {
  queries?: Array<{ id: string; query?: ProceduresQuery }>;
}

const MAX_COUNT_QUERIES = 50;

/** A procedure as the runs table's relation picker lists it. */
export interface ProcedureOption {
  procedureId: string;
  _id: string;
  name: string;
}

/**
 * The picker's options, sorted by name: those of the `ids` asked for when
 * there are (`?ids=`: how a picked procedure's chip and field name it), else
 * those the search matches.
 */
export function procedureOptions(
  procedures: Array<{ _id: string; name: string }>,
  search: unknown,
  ids: string[] = [],
): ProcedureOption[] {
  const q = folded(queryText(search));
  const asked = new Set(ids);
  return procedures
    .map((p) => ({ procedureId: p._id, _id: p._id, name: p.name }))
    .filter((p) => asked.size === 0 || asked.has(p.procedureId))
    .filter((p) => !q || folded(p.name).includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const procedureSummaryRoutes = {
  // `select` feeds the procedure picker of the runs table (its relation
  // filter): `{ procedureId, name }` read straight from the Procedure table,
  // narrowed to `?ids=` or to the picker's search, sorted by name.
  select: {
    method: "GET",
    args: [
      AuthOwnerOnly(),
      Parameter("search", "query"),
      Parameter("offset", "query"),
      Parameter("limit", "query"),
      MultiParameter("ids", "query"),
    ],
    // Each parameter is bound to a request input by its decorator, so
    // the framework hands them in positionally.
    // oxlint-disable-next-line eslint/max-params
    func: async (
      _user: User,
      search?: string,
      offset?: string,
      limit?: string,
      ids?: string[],
    ) => {
      const procedures = await GetModel(ProcedureModel, DATABASE_NAME).getAll();
      const options = procedureOptions(procedures, search, ids);
      const off = toInt(offset, 0, 0);
      const lim = toInt(limit, DEFAULT_PAGE_SIZE, 1);
      return {
        results: options.slice(off, off + lim),
        total: options.length,
        offset: off,
        limit: lim,
      };
    },
  },
  get: {
    method: "GET",
    args: [AuthOwnerOnly(), Parameters.Get()],
    func: async (_user: User, params: { id: string }) => {
      const found = await getProcedureSummary(params.id);
      if (!found) {
        throw new HTTPResult(404, {
          error: `procedure "${params.id}" not found`,
        });
      }
      return found;
    },
  },
  list: {
    method: "GET",
    args: [
      AuthOwnerOnly(),
      Parameter("offset", "query"),
      Parameter("limit", "query"),
      Parameter("sortKey", "query"),
      Parameter("sortDirection", "query"),
      Parameter("search", "query"),
      Parameter("filter_status", "query"),
      Parameter("filter_triggerTypes", "query"),
    ],
    // Each parameter is bound to a request input by its decorator, so
    // the framework hands them in positionally: an options object is not
    // expressible here.
    // oxlint-disable-next-line eslint/max-params
    func: async (
      _user: User,
      offset?: string,
      limit?: string,
      sortKey?: string,
      sortDirection?: string,
      search?: string,
      filterStatus?: string,
      filterTriggerTypes?: string,
    ) => {
      const filtered = applyQuery(await getProceduresSummary(), {
        search,
        filter_status: filterStatus,
        filter_triggerTypes: filterTriggerTypes,
      });
      const sorted = sortRows(filtered, sortKey, sortDirection);
      const off = toInt(offset, 0, 0);
      const lim = toInt(limit, DEFAULT_PAGE_SIZE, 1);
      return {
        results: sorted.slice(off, off + lim),
        total: filtered.length,
        offset: off,
        limit: lim,
      };
    },
  },
  count: {
    method: "GET",
    args: [
      AuthOwnerOnly(),
      Parameter("search", "query"),
      Parameter("filter_status", "query"),
      Parameter("filter_triggerTypes", "query"),
    ],
    func: async (
      _user: User,
      search?: string,
      filterStatus?: string,
      filterTriggerTypes?: string,
    ) => {
      const filtered = applyQuery(await getProceduresSummary(), {
        search,
        filter_status: filterStatus,
        filter_triggerTypes: filterTriggerTypes,
      });
      return { total: filtered.length };
    },
  },
  // The tab counters: one count per tab in one request, over one summary.
  countBatch: {
    endpoint: "/count/batch",
    callback: {
      method: "POST",
      args: [AuthOwnerOnly(), JSONBody()],
      func: async (_user: User, body: CountBatchBody) => {
        const queries = Array.isArray(body?.queries) ? body.queries : [];
        if (queries.length > MAX_COUNT_QUERIES) {
          throw new HTTPResult(400, {
            error: "Too many count batch queries.",
          });
        }
        const rows = await getProceduresSummary();
        return Object.fromEntries(
          queries.map(({ id, query }) => [
            id,
            applyQuery(rows, query ?? {}).length,
          ]),
        );
      },
    },
  },
  delete: {
    method: "DELETE",
    args: [AuthOwnerOnly(), Parameters.Delete()],
    func: async (_user: User, params: { id: string | string[] }) => {
      const ids = Array.isArray(params.id) ? params.id : [params.id];
      const model = GetModel(ProcedureModel, DATABASE_NAME);
      for (const id of ids) {
        await model.delete(id);
        await subscriptions.onProcedureDelete(id);
      }
      return ids.length;
    },
  },
};

const STATUS_ITEMS = [
  {
    value: "failing",
    label: "$dms_automation.procedures.status.failing",
    icon: "i-ph-x-circle",
  },
  {
    value: "degraded",
    label: "$dms_automation.procedures.status.degraded",
    icon: "i-ph-warning",
  },
  {
    value: "healthy",
    label: "$dms_automation.procedures.status.healthy",
    icon: "i-ph-check-circle",
  },
  {
    value: "paused",
    label: "$dms_automation.procedures.status.paused",
    icon: "i-ph-pause-circle",
  },
  {
    value: "draft",
    label: "$dms_automation.procedures.status.draft",
    icon: "i-ph-pencil-simple-line",
  },
];

/** The built-in trigger types, for the trigger filter. */
const TRIGGER_TYPE_ITEMS = builtinTriggers.map((t) => ({
  value: t.id,
  label: t.name,
  icon: t.icon,
}));

@RegisterDataController()
export class ProceduresTableAPI extends DataController(
  Procedure,
  procedureSummaryRoutes,
  Controller("/api/automation/tables/procedures"),
) {
  // The module's named database: the relation of the runs table joins
  // through this model, and reads nothing from the default instance.
  @ModelReference()
  @Model(ProcedureModel, DATABASE_NAME)
  declare model: ProcedureModel;

  // Five columns whose widths add up to the list beside an open sidebar at
  // 1024 px; wider screens spread them. The state comes second, so a phone
  // still shows it by the name. The last run's date sits under the run strip;
  // the average duration is in the column picker.
  @Searchable()
  @Sortable({ noIndex: true })
  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.procedure",
    size: 160,
    type: new DefaultDataTypes.StringType(),
    display: new ProcedureLinkDisplay({
      icon: "i-ph-flow-arrow",
      subtitleField: "description",
      url: `${BUILDER_URL}?selected={{row.procedureId}}`,
    }),
    order: 1,
  })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.description",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
    order: 10,
  })
  @Access(AccessMode.ReadOnly)
  declare description: string;

  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.trigger",
    size: 120,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.TwoLineDisplay({
      primaryField: "triggerText",
      subField: "triggerTypeText",
    }),
    order: 3,
  })
  @Access(AccessMode.ReadOnly)
  declare triggerSummary: string;

  /** The trigger in words: the first line of the "Starts when" cell. */
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare triggerText: BlockText;

  /** The trigger's type and how many follow, under its settings. */
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare triggerTypeText: BlockText | null;

  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.triggerTypes",
    type: new DefaultDataTypes.SelectType({
      items: TRIGGER_TYPE_ITEMS,
      multiple: true,
    }),
    isVisible: false,
    filterable: true,
    order: 13,
  })
  @Access(AccessMode.ReadOnly)
  declare triggerTypes: string[];

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.status",
    size: 125,
    type: new DefaultDataTypes.SelectType({ items: STATUS_ITEMS }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: {
        failing: "error",
        degraded: "warning",
        healthy: "success",
        paused: "neutral",
        draft: "info",
      },
      subField: "statusDetail",
    }),
    filterable: true,
    order: 2,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  /** What the state rests on, under the status pill. */
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare statusDetail: CellSublineValue | null;

  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.statusDetail",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
    order: 11,
  })
  @Access(AccessMode.ReadOnly)
  declare lastError: string;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.recentRuns",
    size: 120,
    type: new DefaultDataTypes.DateType(),
    display: new LastRunsDisplay({
      limit: 12,
      runsField: "lastRuns",
      runUrl: `${TRACE_URL}?run={{row.runId}}`,
      emptyLabel: "$dms_automation.procedures.never",
    }),
    order: 4,
  })
  @Access(AccessMode.ReadOnly)
  declare lastRunAt: string;

  /** The last run, which "Open last run" opens. */
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare lastRunId: string | null;

  /** The last runs, drawn as the strip of the "Last runs" cell. */
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare lastRuns: string;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.successRate",
    size: 118,
    type: new DefaultDataTypes.PercentageType({ min: 0, max: 1, step: 0.01 }),
    order: 5,
  })
  @Access(AccessMode.ReadOnly)
  declare successRate: number;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.avg",
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.DurationDisplay({ unit: "ms" }),
    isVisible: false,
    order: 14,
  })
  @Access(AccessMode.ReadOnly)
  declare avgDurationMs: number;

  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.enabled",
    type: new DefaultDataTypes.BooleanType(),
    isVisible: false,
    order: 12,
  })
  @Access(AccessMode.ReadOnly)
  declare enabled: boolean;
}
