import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { Model } from "@antelopejs/interface-database-decorators";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import { Searchable } from "@antelopejs/interface-dms/base/searchable";
import {
  Column,
  DefaultDisplays,
  Exported,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base/table-view";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import { ProcedureRun } from "../db/tables/procedure_run.table";
import { StepDisplay, TriggerDisplay } from "../displays";
import type { StepName, TriggerSummary } from "../runtime/describe";
import { DATABASE_NAME } from "../types/constants";
import { ProceduresTableAPI } from "./procedures-table";

// Runs are history: the table view only reads and exports them. Everything the
// list draws is stored on the run when it ends (its duration, its trigger, the
// step it failed at), so the built-in routes serve it straight from the table,
// with their own `list` permission check. The procedure's name comes from the
// relation, which follows a rename.
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
  { value: "run", label: "$dms_automation.runs.kind.run" },
  { value: "rerun", label: "$dms_automation.runs.kind.rerun" },
  { value: "test", label: "$dms_automation.runs.kind.test" },
];

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
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      nowWithinMs: 60_000,
      nowLabel: "$dms_automation.runs.justNow",
    }),
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
    size: 260,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({
      icon: "i-ph-flow-arrow",
      subtitleField: "_id",
    }),
    order: 2,
  })
  @Access(AccessMode.ReadOnly)
  declare procedureName: string;

  // Filter-only relation: the funnel and the quick filter pick a procedure
  // through the procedures controller's `select` route, and the row keeps the
  // raw id (the drawer and "View runs" links filter on it).
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

  @Listable()
  @Column({
    name: "$dms_automation.runs.cols.trigger",
    size: 220,
    type: new DefaultDataTypes.StringType(),
    display: new TriggerDisplay(),
    order: 3,
  })
  @Access(AccessMode.ReadOnly)
  declare triggerSummary: TriggerSummary;

  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.status",
    size: 240,
    type: new DefaultDataTypes.SelectType({ items: STATUS_ITEMS }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: { ok: "success", failed: "error" },
      subField: "errorMessage",
    }),
    filterable: true,
    order: 4,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Listable()
  @Column({
    name: "$dms_automation.runs.cols.failedStep",
    type: new DefaultDataTypes.StringType(),
    display: new StepDisplay(),
    order: 5,
  })
  @Access(AccessMode.ReadOnly)
  declare failedStep: StepName;

  @Listable()
  @Sortable({ noIndex: true })
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.duration",
    size: 100,
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
    size: 100,
    type: new DefaultDataTypes.SelectType({ items: KIND_ITEMS }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: { run: "neutral", rerun: "info", test: "secondary" },
    }),
    filterable: true,
    order: 7,
  })
  @Access(AccessMode.ReadOnly)
  declare kind: string;

  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.triggerType",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    isVisible: false,
    order: 8,
  })
  @Access(AccessMode.ReadOnly)
  declare triggerType: string;

  @Searchable()
  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.error",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
    order: 9,
  })
  @Access(AccessMode.ReadOnly)
  declare errorMessage: string;

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
}
