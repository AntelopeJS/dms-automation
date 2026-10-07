import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const proceduresTableName = "procedures";

@RegisterTable(proceduresTableName, SCHEMA_NAME)
export class Procedure extends Table {
  @Index()
  @Field("string")
  declare name: string;

  @Field("string")
  declare description: string;

  @Index()
  @Field("boolean")
  declare enabled: boolean;

  /** JSON stringified ProcedureGraph */
  @Field("string")
  declare graph: string;

  /** Incremented on every save; stamped on the runs it executes. */
  @Field("number")
  declare version?: number;

  /** When the procedure was last disabled, and by whom (a display name). */
  @Field("date")
  declare pausedAt?: Date;

  @Field("string")
  declare pausedBy?: string;

  /**
   * When someone dismissed the procedure from the overview's "Needs
   * attention" list; it comes back on its next failure.
   */
  @Field("date")
  declare attentionDismissedAt?: Date;

  @Field("date")
  declare created_at: Date;

  @Field("date")
  declare updated_at: Date;
}
