import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";
import type { RunLog } from "../../types/runLog";
import { Procedure } from "./procedure.table";

export const procedureRunsTableName = "procedure_runs";

@RegisterTable(procedureRunsTableName, SCHEMA_NAME)
export class ProcedureRun extends Table {
  @Index()
  @Field("string")
  @Relation({ to: () => Procedure })
  declare procedureId: string;

  @Field("date")
  declare startedAt: Date;

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
}
