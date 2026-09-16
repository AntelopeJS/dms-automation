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
  Exported,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base/table-view";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import { ProcedureRun } from "../db/tables/procedure_run.table";
import { DATABASE_NAME } from "../types/constants";
import { ProceduresTableAPI } from "./procedures-table";

// The Runs list is the raw `procedure_runs` table, so the TableView uses the
// built-in read + export routes (no custom list/count needed): they query the
// model's table directly with the active search/filter/sort/pagination. The
// procedure name and the run duration are NOT stored columns — the timeline
// display resolves the name client-side (procedureId is a filter-only relation,
// so the row keeps the raw id) and derives the duration from
// `startedAt`/`endedAt`. Search covers `triggerNodeId` + `errorMessage` (the
// real text columns; procedure name isn't a column here). Runs are history: only
// reads + export are exposed (no new/edit/delete endpoints).
const runRoutes = {
  get: TableViewRoutes.Get,
  list: TableViewRoutes.List,
  count: TableViewRoutes.Count,
  ...TableViewRoutes.ExportRoutes,
};

@RegisterDataController()
export class RunsTableAPI extends DataController(
  ProcedureRun,
  runRoutes,
  Controller("/api/automation/tables/runs"),
) {
  // Bind to the module's named database instance (DATABASE_NAME): the built-in
  // TableView routes read through `this.model`, and runs are written/read
  // everywhere else via GetModel(ProcedureRunModel, DATABASE_NAME). Without the
  // instance id the default instance is queried and the list comes back empty.
  @ModelReference()
  @Model(ProcedureRunModel, DATABASE_NAME)
  declare model: ProcedureRunModel;

  // The run's own id, plucked into the list rows (hidden column) so the timeline
  // display can open the full run (with logs) via `getRun(row._id)`. The list
  // pluck only includes @Listable columns and does NOT auto-add the rowIdKey, so
  // without this the rows carry no `_id`.
  @Listable()
  @Column({
    name: "ID",
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  // Filter-only relation to the procedures controller (dms 0.1.1): the funnel
  // renders the native dynamic relation picker (options from the custom
  // ProceduresTableAPI/select, which returns `{ procedureId, name }`), but
  // `filterOnly: true` skips the @Foreign join, so the row keeps the raw
  // `procedureId` string and the run's `_id` — both needed by the timeline
  // display (Trace/Replay). `value` maps to the option's `procedureId`
  // (= run.procedureId); it isn't a declared @Column on ProceduresTableAPI,
  // hence the cast.
  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.procedure",
    type: new DefaultDataTypes.RelationType({
      dataApiController: ProceduresTableAPI,
      keyMapping: { label: "name", value: "procedureId" as never },
      filterOnly: true,
    }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare procedureId: string;

  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.status",
    type: new DefaultDataTypes.SelectType({
      items: [
        { value: "ok", label: "$dms_automation.runs.status.ok" },
        { value: "failed", label: "$dms_automation.runs.status.failed" },
      ],
    }),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare status: string;

  @Listable()
  @Sortable({ noIndex: true })
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.startedAt",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare startedAt: Date;

  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.endedAt",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare endedAt: Date;

  @Searchable()
  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.trigger",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  declare triggerNodeId: string;

  @Searchable()
  @Listable()
  @Exported()
  @Column({
    name: "$dms_automation.runs.cols.error",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  declare errorMessage: string;
}
