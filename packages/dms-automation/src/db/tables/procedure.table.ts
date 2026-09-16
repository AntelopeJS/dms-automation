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

  @Field("date")
  declare created_at: Date;

  @Field("date")
  declare updated_at: Date;
}
