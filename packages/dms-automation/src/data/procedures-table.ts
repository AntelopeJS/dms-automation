import { Controller, HTTPResult, Parameter } from "@antelopejs/interface-api";
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
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import { Searchable } from "@antelopejs/interface-dms/base/searchable";
import { Column } from "@antelopejs/interface-dms/base/table-view";
import { ProcedureModel } from "../db/models/procedure.model";
import {
  getProceduresSummary,
  type ProcedureSummaryRow,
} from "../db/models/stats.model";
import { Procedure } from "../db/tables/procedure.table";
import { BuilderPageController } from "../pages/builder";
import { subscriptions } from "../runtime/subscriptions";
import { DATABASE_NAME } from "../types/constants";

// The Procedures list is a computed aggregate (success rate, avg duration, last
// run over a 7-day window) rather than plain table columns, so the TableView is
// backed by custom `list`/`count` routes that run `getProceduresSummary()` and
// apply the frontend's search/filter/sort/pagination in memory. `get` reuses the
// prefab (real Procedure row); `delete` mirrors ProceduresController.remove so it
// also tears down the procedure's runtime subscriptions.

function parseFilter(
  raw?: string,
): { mode: string; value: string } | undefined {
  if (!raw) return undefined;
  const idx = raw.indexOf(":");
  return idx < 0
    ? { mode: "is", value: raw }
    : { mode: raw.slice(0, idx), value: raw.slice(idx + 1) };
}

function applyQuery(
  rows: ProcedureSummaryRow[],
  search?: string,
  filterStatus?: string,
): ProcedureSummaryRow[] {
  let out = rows;
  const q = search?.trim().toLowerCase();
  if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));

  const sf = parseFilter(filterStatus);
  if (sf) {
    const wanted = sf.value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (wanted.length) {
      out =
        sf.mode === "is_not"
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

function sortRows(
  rows: ProcedureSummaryRow[],
  sortKey?: string,
  sortDirection?: string,
): ProcedureSummaryRow[] {
  if (!sortKey || !SORTABLE_KEYS.has(sortKey as keyof ProcedureSummaryRow)) {
    return rows;
  }
  const k = sortKey as keyof ProcedureSummaryRow;
  const dir = sortDirection === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[k];
    const bv = b[k];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls last, irrespective of direction
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });
}

// Parse a query-string integer, falling back when it is missing or not a finite
// positive number (so a malformed `?limit=abc` doesn't slice to an empty page).
function toPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const procedureSummaryRoutes = {
  // Custom `select` feeding the runs filter-only RelationType picker. The
  // built-in select can't be used here: it plucks @Select columns from the real
  // Procedure table, but our id (`procedureId`) is a renamed `_id` that only
  // exists on the computed summary. Query the Procedure table directly for
  // `{ procedureId: _id, name }` (no run aggregation — the picker only needs
  // id + name), filtered by the relation's `search` and sorted by name.
  select: {
    method: "GET",
    args: [
      AuthRawUser(),
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
        .map((p) => ({ procedureId: p._id, name: p.name }))
        .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
        .sort((a, b) => a.name.localeCompare(b.name));
      const off = toPositiveInt(offset, 0);
      const lim = toPositiveInt(limit, 10);
      return {
        results: options.slice(off, off + lim),
        total: options.length,
        offset: off,
        limit: lim,
      };
    },
  },
  // `get` returns the computed summary row (not the raw Procedure) so the
  // read-only details view shows the same trigger/status/stats columns as the
  // list. Enabling details (even hidden) is also what gives rows the standard
  // full-row hover highlight — see the page's rowActions.
  get: {
    method: "GET",
    args: [AuthRawUser(), Parameters.Get()],
    func: async (_user: User, params: { id: string }) => {
      const rows = await getProceduresSummary();
      const found = rows.find((r) => r.procedureId === params.id);
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
      AuthRawUser(),
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
      // Coerce defensively: a non-numeric offset/limit must fall back, not
      // become NaN (which would silently slice to an empty page).
      const off = toPositiveInt(offset, 0);
      const lim = toPositiveInt(limit, 10);
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
      AuthRawUser(),
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
  delete: {
    method: "DELETE",
    // Mutations require the builder/edit permission, matching the old
    // ProceduresController.remove gate. Reads above only require an
    // authenticated user (dms does NOT auto-gate DataController routes).
    args: [AuthUserWithPermission(BuilderPageController), Parameters.Delete()],
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

@RegisterDataController()
export class ProceduresTableAPI extends DataController(
  Procedure,
  procedureSummaryRoutes,
  Controller("/api/automation/tables/procedures"),
) {
  @ModelReference()
  @Model(ProcedureModel)
  declare model: ProcedureModel;

  @Searchable()
  @Sortable({ noIndex: true })
  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.procedure",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.trigger",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  declare trigger: string;

  @Listable()
  @Column({
    name: "$dms_automation.procedures.cols.status",
    type: new DefaultDataTypes.SelectType({
      items: [
        { value: "active", label: "$dms_automation.procedures.status.active" },
        { value: "paused", label: "$dms_automation.procedures.status.paused" },
        {
          value: "failing",
          label: "$dms_automation.procedures.status.failing",
        },
      ],
    }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.lastRun",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare lastRunAt: string;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.success",
    type: new DefaultDataTypes.PercentageType({ min: 0, max: 1, step: 0.01 }),
  })
  @Access(AccessMode.ReadOnly)
  declare successRate: number;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.avg",
    type: new DefaultDataTypes.NumberType(),
  })
  @Access(AccessMode.ReadOnly)
  declare avgDurationMs: number;

  @Listable()
  @Sortable({ noIndex: true })
  @Column({
    name: "$dms_automation.procedures.cols.runs",
    type: new DefaultDataTypes.NumberType(),
  })
  @Access(AccessMode.ReadOnly)
  declare runs: number;
}
