import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const triggerTypeConfigsTableName = "trigger_type_configs";

@RegisterTable(triggerTypeConfigsTableName, SCHEMA_NAME)
export class TriggerTypeConfig extends Table {
  @Index()
  @Field("string")
  declare typeId: string;

  @Field("boolean")
  declare enabled: boolean;

  /** JSON stringified config */
  @Field("string")
  declare config: string;
}
