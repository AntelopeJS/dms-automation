import {
  Controller,
  HTTPResult,
  JSONBody,
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
import { LastRunsDisplay } from "../displays";
import { stateRank } from "../stats/health";
import { subscriptions } from "../runtime/subscriptions";
import { DATABASE_NAME } from "../types/constants";

// The Procedures list is a computed aggregate (state, last runs, success rate
// over 7 days) rather than plain table columns, so the TableView is backed by
// custom `list`/`count`/`countBatch` routes that compute the summary and apply
// the table's search, status filter, sort and pagination in memory. `delete`
// also tears down the procedure's runtime subscriptions. Module pages are the
// platform owner's alone, so every route is owner-only, like the module's API.

function parseFilter(
  raw?: string,
): { mode: string; value: string } | undefined {
  if (!raw) return undefined;
  const idx = raw.indexOf(":");
  return idx < 0
    ? { mode: "is", value: raw }
    : { mode: raw.slice(0, idx), value: raw.slice(idx + 1) };
}

const NEGATED_MODES = new Set(["is_not", "exclude"]);

function applyQuery(
  rows: ProcedureSummaryRow[],
  search?: string,
  filterStatus?: string,
): ProcedureSummaryRow[] {
  let out = rows;
  const q = search?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }

  const sf = parseFilter(filterStatus);
  if (sf) {
    const wanted = sf.value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (wanted.length) {
      out = NEGATED_MODES.has(sf.mode)
        ? out.filter((r) => !wanted.includes(r.status))
        : out.filter((r) => wanted.includes(r.status));
    }
  }
  return out;
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

function sortRows(
  rows: ProcedureSummaryRow[],
  sortKey?: string,
  sortDirection?: string,
): ProcedureSummaryRow[] {
  if (!sortKey || !SORTABLE_KEYS.has(sortKey as keyof ProcedureSummaryRow)) {
    // Default order: the procedures that need attention first.
    return [...rows].sort((a, b) => stateRank(a.status) - stateRank(b.status));
  }
  const k = sortKey as keyof ProcedureSummaryRow;
  const dir = sortDirection === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => compareValues(a[k], b[k], dir));
}

// Parse a query-string integer, falling back when it is missing or not a finite
// number (so a malformed `?limit=abc` doesn't slice to an empty page).
function toInt(raw: string | undefined, fallback: number, min: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

const DEFAULT_PAGE_SIZE = 10;

interface CountBatchBody {
  queries?: Array<{ id: string; query?: Record<string, string | undefined> }>;
}

const MAX_COUNT_QUERIES = 50;

const procedureSummaryRoutes = {
  // `select` feeds the procedure picker of the runs table (its relation
  // filter): `{ procedureId, name }` read straight from the Procedure table,
  // filtered by the picker's search and sorted by name.
  select: {
    method: "GET",
    args: [
      AuthOwnerOnly(),
      Parameter("search", "query"),
      Parameter("offset", "query"),
      Parameter("limit", "query"),
    ],
    func: async (
      _user: User,
      search?: string,
      offset?: string,
      limit?: string,
    ) => {
      const q = search?.trim().toLowerCase();
      const procedures = await GetModel(ProcedureModel, DATABASE_NAME).getAll();
      const options = procedures
        .map((p) => ({ procedureId: p._id, _id: p._id, name: p.name }))
        .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
        .sort((a, b) => a.name.localeCompare(b.name));
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
    ) => {
      const filtered = applyQuery(
        await getProceduresSummary(),
        search,
        filterStatus,
      );
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
    ],
    func: async (_user: User, search?: string, filterStatus?: string) => {
      const filtered = applyQuery(
        await getProceduresSummary(),
        search,
        filterStatus,
      );
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
            applyQuery(rows, query?.search, query?.filter_status).length,
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

  @Searchable()
  @Sortable({ noIndex: true })
  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.procedure",
    size: 280,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({
      icon: "i-ph-flow-arrow",
      subtitleField: "description",
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
    size: 200,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.TwoLineDisplay({
      primaryField: "triggerText",
      subField: "triggerTypeText",
    }),
    order: 2,
  })
  @Access(AccessMode.ReadOnly)
  declare triggerSummary: string;

  /** The trigger in words: the first line of the "Starts when" cell. */
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare triggerText: BlockText;

  /** The trigger's type under its settings, when the first line does not name it. */
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare triggerTypeText: BlockText | null;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.status",
    size: 200,
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
    order: 3,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.statusDetail",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
    order: 11,
  })
  @Access(AccessMode.ReadOnly)
  declare statusDetail: string;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.lastRun",
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      emptyLabel: "$dms_automation.procedures.never",
      emptyTone: "dimmed",
    }),
    order: 4,
  })
  @Access(AccessMode.ReadOnly)
  declare lastRunAt: string;

  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.lastRuns",
    size: 130,
    type: new DefaultDataTypes.StringType(),
    display: new LastRunsDisplay({ limit: 12 }),
    order: 5,
  })
  @Access(AccessMode.ReadOnly)
  declare lastRuns: string;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.success",
    size: 100,
    type: new DefaultDataTypes.PercentageType({ min: 0, max: 1, step: 0.001 }),
    order: 6,
  })
  @Access(AccessMode.ReadOnly)
  declare successRate: number;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.avg",
    size: 90,
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.DurationDisplay({ unit: "ms" }),
    order: 7,
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
