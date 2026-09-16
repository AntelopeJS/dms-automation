import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const actionTypeConfigsTableName = "action_type_configs";

@RegisterTable(actionTypeConfigsTableName, SCHEMA_NAME)
export class ActionTypeConfig extends Table {
  @Index()
  @Field("string")
  declare typeId: string;

  @Field("boolean")
  declare enabled: boolean;

  /** JSON stringified config */
  @Field("string")
  declare config: string;
}
