import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";
import type { StepName, TriggerSummary } from "../../runtime/describe";
import type { RunKind, RunLog } from "../../types/runLog";
import { Procedure } from "./procedure.table";

export const procedureRunsTableName = "procedure_runs";

@RegisterTable(procedureRunsTableName, SCHEMA_NAME)
export class ProcedureRun extends Table {
  @Index({ group: "procedureId_startedAt" })
  @Field("string")
  @Relation({ to: () => Procedure })
  declare procedureId: string;

  @Index()
  @Index({ group: "procedureId_startedAt" })
  @Field("date")
  declare startedAt: Date;

  /**
   * The procedure's name, kept on the run so the run list sorts, searches and
   * draws it without a join; renaming a procedure renames its runs.
   */
  @Field("string")
  declare procedureName?: string;

  @Field("date")
  declare endedAt?: Date;

  @Field("string")
  declare status: string;

  @Field("string")
  declare errorMessage?: string;

  @Field("string")
  declare triggerNodeId: string;

  /** JSON stringified trigger payload */
  @Field("string")
  declare triggerPayload: string;

  @Field("any")
  declare logs?: RunLog;

  /** What started the run; absent on runs stored before kinds existed. */
  @Index()
  @Field("string")
  declare kind?: RunKind;

  /** Run whose payload a `rerun` replayed. */
  @Field("string")
  declare rerunOf?: string;

  /** Node whose failure ended a failed run. */
  @Field("string")
  declare failedNodeId?: string;

  /** Instance that executed the run. */
  @Field("string")
  declare instanceId?: string;

  /** `endedAt - startedAt`, stored so the list sorts and draws it. */
  @Field("number")
  declare durationMs?: number;

  /** Type id of the trigger that started the run. */
  @Index()
  @Field("string")
  declare triggerType?: string;

  /** The trigger as it was when the run started (type, method, path, cron). */
  @Field("any")
  declare triggerSummary?: TriggerSummary;

  /** The failing step as it was named when the run failed. */
  @Field("any")
  declare failedStep?: StepName;

  /** Procedure version the run executed. */
  @Field("number")
  declare procedureVersion?: number;
}
