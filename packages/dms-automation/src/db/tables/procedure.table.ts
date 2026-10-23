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

  /** Incremented when the graph changes; stamped on the runs it executes. */
  @Field("number")
  declare version: number;

  /**
   * Incremented on every write a builder still open could overwrite (a save,
   * a pause, a resume): a save names the revision it was made on and is
   * refused when the procedure moved on since.
   */
  @Field("number")
  declare revision: number;

  /** When the procedure was last disabled, and by whom (a display name). */
  @Field("date")
  declare pausedAt?: Date;

  @Field("string")
  declare pausedBy?: string;

  /**
   * When someone dismissed the procedure from the overview's "Needs
   * attention" list; it comes back on its next failure. Null once undone.
   */
  @Field("date")
  declare attentionDismissedAt?: Date | null;

  /**
   * Why triggers of the procedure failed to arm, by trigger node id (JSON of
   * `Record<string, ArmError>`, see runtime/armErrors.ts): kept on the
   * procedure so every instance reports the same state.
   */
  @Field("string")
  declare armErrors?: string;

  @Field("date")
  declare created_at: Date;

  @Field("date")
  declare updated_at: Date;
}
