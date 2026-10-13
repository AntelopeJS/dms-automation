import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  type SwitchableKind,
  TypeSwitch,
  typeSwitchesTableName,
} from "../tables/type_switch.table";

export class TypeSwitchModel extends BasicDataModel(
  TypeSwitch,
  typeSwitchesTableName,
) {
  /** Whether a type is switched on: it is unless the library switched it off. */
  async isEnabled(kind: SwitchableKind, typeId: string): Promise<boolean> {
    return (await this.find(kind, typeId))?.enabled ?? true;
  }

  async setEnabled(
    kind: SwitchableKind,
    typeId: string,
    enabled: boolean,
  ): Promise<void> {
    const existing = await this.find(kind, typeId);
    if (existing) await this.update(existing._id, { enabled });
    else await this.insert({ kind, typeId, enabled });
  }

  private async find(
    kind: SwitchableKind,
    typeId: string,
  ): Promise<TypeSwitch | undefined> {
    const [row] = await this.table
      .filter((doc) =>
        doc.key("kind").eq(kind).and(doc.key("typeId").eq(typeId)),
      )
      .run();
    return row;
  }
}
