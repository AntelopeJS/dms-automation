import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Filter,
  type FilterFunction,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import type { ValueProxy } from "@antelopejs/interface-database";
import { Model } from "@antelopejs/interface-database-decorators";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import type { BlockText } from "@antelopejs/interface-dms/base/types";
import { Searchable } from "@antelopejs/interface-dms/base/searchable";
import {
  Column,
  DefaultDisplays,
  Exported,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base/table-view";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import { ProcedureRun } from "../db/tables/procedure_run.table";
import {
  clearCredentialPattern,
  escapeRegex,
  scrubSecrets,
  storedSecretsOf,
} from "../runtime/boundRunLog";
import { builtinTriggers } from "../runtime/builtins/triggers";
import type { StepName, TriggerSummary } from "../runtime/describe";
import { stepText, triggerText, triggerTypeText } from "../runtime/wording";
import { DATABASE_NAME } from "../types/constants";
import { ProceduresTableAPI } from "./procedures-table";

// Runs are history: the table view only reads and exports them. Everything the
// list draws is stored on the run when it ends (its duration, its trigger, the
// step it failed at), so the built-in routes serve it straight from the table,
// with their own `list` permission check. The procedure's name is stored on
// the run and rewritten when the procedure is renamed.
const runRoutes = {
  get: TableViewRoutes.Get,
  list: TableViewRoutes.List,
  count: TableViewRoutes.Count,
  countBatch: TableViewRoutes.CountBatch,
  ...TableViewRoutes.ExportRoutes,
};

const STATUS_ITEMS = [
  {
    value: "ok",
    label: "$dms_automation.runs.status.ok",
    icon: "i-ph-check-circle",
  },
  {
    value: "failed",
    label: "$dms_automation.runs.status.failed",
    icon: "i-ph-x-circle",
  },
];

const KIND_ITEMS = [
  { value: "run", label: "$dms_automation.runs.kind.run", icon: "i-ph-play" },
  {
    value: "rerun",
    label: "$dms_automation.runs.kind.rerun",
    icon: "i-ph-arrow-clockwise",
  },
  {
    value: "test",
    label: "$dms_automation.runs.kind.test",
    icon: "i-ph-flask",
  },
];

// The trigger types the filter offers: the module's own, by their name.
const TRIGGER_TYPE_ITEMS = builtinTriggers.map((t) => ({
  value: t.id,
  label: t.name,
  icon: t.icon,
}));

/**
 * The runs whose error contains `text` (the search, the "Error" filter). A run
 * stored before the project marked a name as sensitive (`runs.sensitiveNames`)
 * is left out: its error may hold a secret, which a search could guess
 * character by character.
 */
function errorContains(row: ValueProxy<RunsTableAPI>, text: string) {
  return row
    .key("errorMessage")
    .default("")
    .match(containing(text))
    .and(row.key("triggerPayload").match(clearCredentialPattern()).not());
}

// The data API hands a filter the row sixth.
// oxlint-disable-next-line eslint/max-params
const errorFilter: FilterFunction<RunsTableAPI, RunsTableAPI> = (
  _c,
  _e,
  _k,
  value,
  _m,
  row,
) => errorContains(row, value);

/**
 * The procedure filter (the funnel, the quick filter, `?procedure=`): the
 * relation's own compare modes, except that a blank id filters nothing.
 */
function procedureFilter(
  id: ValueProxy<unknown>,
  value: string,
  mode: string,
): ValueProxy<boolean> | boolean {
  if (mode === "is_empty") return id.default(null).eq(null);
  if (mode === "is_not_empty") return id.default(null).ne(null);
  if (!value) return true;
  return mode === "is_not" ? id.ne(value) : id.eq(value);
}

/** A case-insensitive pattern matching a value that contains `text`. */
function containing(text: string): string {
  return `(?i)${escapeRegex(text.trim())}`;
}

@RegisterDataController()
export class RunsTableAPI extends DataController(
  ProcedureRun,
  runRoutes,
  Controller("/api/automation/tables/runs"),
) {
  // The built-in routes read through `this.model`, bound to the module's named
  // database: runs are written there by the runtime.
  @ModelReference()
  @Model(ProcedureRunModel, DATABASE_NAME)
  declare model: ProcedureRunModel;

  // The row id, so the run drawer and the trace link can read the full run.
  // The search finds a run by its id or the start of it.
  @Searchable()
  @Filter((_ctx, id, _key, value) =>
    id.match(`(?i)^${escapeRegex(value.trim())}`),
  )
  @Listable()
  @Column({
    name: "$dms_automation.runs.cols.id",
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay({ copy: true }),
    isVisible: false,
    order: 90,
  })
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Listable()
  @Sortable({ noIndex: true })
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.startedAt",
    size: 130,
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      nowWithinMs: 60_000,
      nowLabel: "$dms_automation.runs.justNow",
    }),
    // The grouped display counts each day with a date-range filter on it.
    filterable: true,
    order: 1,
  })
  @Access(AccessMode.ReadOnly)
  declare startedAt: Date;

  @Searchable()
  @Sortable({ noIndex: true })
  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.procedure",
    size: 190,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({
      icon: "i-ph-flow-arrow",
      subtitleField: "_id",
    }),
    order: 3,
  })
  @Access(AccessMode.ReadOnly)
  declare procedureName: string;

  // Filter-only relation: the funnel and the quick filter pick a procedure
  // through the procedures controller's `select` route, and the row keeps the
  // raw id (the drawer and "View runs" links filter on it).
  @Filter((_ctx, id, _key, value, mode) =>
    procedureFilter(id, value.trim(), mode),
  )
  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.procedureFilter",
    type: new DefaultDataTypes.RelationType({
      dataApiController: ProceduresTableAPI,
      keyMapping: { label: "name", value: "procedureId" as never },
      filterOnly: true,
    }),
    filterable: true,
    isVisible: false,
    order: 12,
  })
  @Access(AccessMode.ReadOnly)
  declare procedureId: string;

  // The search finds a webhook run by its path.
  @Searchable()
  @Filter((_ctx, summary, _key, value) =>
    summary.key("path").default("").match(containing(value)),
  )
  @Listable()
  @Column({
    name: "$dms_automation.runs.cols.trigger",
    size: 150,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.TwoLineDisplay({
      primaryField: "triggerText",
      subField: "triggerTypeText",
    }),
    order: 4,
  })
  @Access(AccessMode.ReadOnly)
  declare triggerSummary: TriggerSummary;

  /**
   * The trigger in words: the first line of the trigger cell. A run whose
   * trigger node was not found in its graph when it was stored has none.
   */
  @Listable(["triggerSummary"])
  @Access(AccessMode.ReadOnly)
  get triggerText(): BlockText {
    return this.triggerSummary
      ? triggerText(this.triggerSummary)
      : "$dms_automation.runs.unknownTrigger";
  }

  /** The trigger's type under its settings, when the first line does not name it. */
  @Listable(["triggerSummary"])
  @Access(AccessMode.ReadOnly)
  get triggerTypeText(): BlockText | null {
    return triggerTypeText(this.triggerSummary);
  }

  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.status",
    size: 130,
    type: new DefaultDataTypes.SelectType({ items: STATUS_ITEMS }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: { ok: "success", failed: "error" },
      subField: "errorText",
    }),
    filterable: true,
    order: 2,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  // The search finds a failed run by the label of the step it failed at.
  @Searchable()
  @Filter((_ctx, step, _key, value) =>
    step.key("label").default("").match(containing(value)),
  )
  @Listable()
  @Column({
    name: "$dms_automation.runs.cols.failedStep",
    size: 130,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.TwoLineDisplay({
      primaryField: "failedStepText",
    }),
    order: 5,
  })
  @Access(AccessMode.ReadOnly)
  declare failedStep: StepName;

  /** The step the run failed at, by its label or its type's name. */
  @Listable(["failedStep"])
  @Access(AccessMode.ReadOnly)
  get failedStepText(): BlockText | null {
    return stepText(this.failedStep);
  }

  @Listable()
  @Sortable({ noIndex: true })
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.duration",
    size: 140,
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.DurationDisplay({ unit: "ms" }),
    order: 6,
  })
  @Access(AccessMode.ReadOnly)
  declare durationMs: number;

  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.kind",
    size: 110,
    type: new DefaultDataTypes.SelectType({ items: KIND_ITEMS }),
    // Told apart by their icons; neutral keeps the test pill legible in the
    // light theme.
    display: new DefaultDisplays.StatusPillDisplay({
      tones: { run: "neutral", rerun: "info", test: "neutral" },
      subField: "versionText",
    }),
    filterable: true,
    order: 7,
  })
  @Access(AccessMode.ReadOnly)
  declare kind: string;

  /** Under the kind, for a run of an older version: "v1 · now v3". */
  @Listable(["procedureVersion", "procedureCurrentVersion"])
  @Access(AccessMode.ReadOnly)
  get versionText(): BlockText | null {
    const { procedureVersion: version, procedureCurrentVersion: current } =
      this.table;
    if (!version || !current || version >= current) return null;
    return {
      key: "dms_automation.runs.olderVersion",
      params: { version, current },
    };
  }

  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.triggerType",
    type: new DefaultDataTypes.SelectType({ items: TRIGGER_TYPE_ITEMS }),
    filterable: true,
    isVisible: false,
    order: 8,
  })
  @Access(AccessMode.ReadOnly)
  declare triggerType: string;

  // Searched, never served as it is stored: a run stored before the project
  // marked a name as sensitive may hold that credential. The list reads
  // `errorText`.
  @Searchable()
  @Filter(errorFilter)
  declare errorMessage: string;

  // Read by the error search only (see `errorContains`), never served.
  declare triggerPayload: string;

  /**
   * The error a run failed with, without a credential it received. Not
   * exported: the DMS export writes stored fields, not computed ones.
   */
  @Filter(errorFilter)
  @Listable(["errorMessage", "triggerPayload"])
  @Column({
    name: "$dms_automation.runs.cols.error",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
    order: 9,
  })
  @Access(AccessMode.ReadOnly)
  get errorText(): string | null {
    const { errorMessage, triggerPayload } = this.table;
    if (!errorMessage) return null;
    return scrubSecrets(errorMessage, storedSecretsOf(triggerPayload));
  }

  @Listable()
  @Column({
    name: "$dms_automation.runs.cols.endedAt",
    type: new DefaultDataTypes.DateType(),
    isVisible: false,
    order: 10,
  })
  @Access(AccessMode.ReadOnly)
  declare endedAt: Date;

  @Listable()
  @Column({
    name: "$dms_automation.runs.cols.rerunOf",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
    order: 11,
  })
  @Access(AccessMode.ReadOnly)
  declare rerunOf: string;

  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.procedureVersion",
    type: new DefaultDataTypes.NumberType(),
    filterable: true,
    isVisible: false,
    order: 13,
  })
  @Access(AccessMode.ReadOnly)
  declare procedureVersion: number;
}
