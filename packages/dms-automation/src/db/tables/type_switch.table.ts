import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { SCHEMA_NAME } from "../../types/constants";

export const typeSwitchesTableName = "type_switches";

/** The types the library can switch off. */
export type SwitchableKind = "trigger" | "action";

/** A trigger or action type switched on or off in the library. */
@RegisterTable(typeSwitchesTableName, SCHEMA_NAME)
export class TypeSwitch extends Table {
  @Index({ group: "kind_typeId" })
  @Field("string")
  declare kind: SwitchableKind;

  @Index({ group: "kind_typeId" })
  @Field("string")
  declare typeId: string;

  @Field("boolean")
  declare enabled: boolean;
}
