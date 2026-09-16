import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const automationTemplatesTableName = "automation_templates";

@RegisterTable(automationTemplatesTableName, SCHEMA_NAME)
export class AutomationTemplate extends Table {
  @Index()
  @Field("string")
  declare name: string;

  @Field("string")
  declare description: string;

  @Field("string")
  declare icon: string;

  /** JSON stringified GroupPort[] */
  @Field("string")
  declare ports: string;

  /** JSON stringified ProcedureGraph */
  @Field("string")
  declare subgraph: string;

  @Index()
  @Field("date")
  declare created_at: Date;

  @Field("date")
  declare updated_at: Date;
}
