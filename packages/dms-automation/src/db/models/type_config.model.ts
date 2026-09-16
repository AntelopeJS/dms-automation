import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  ActionTypeConfig,
  actionTypeConfigsTableName,
} from "../tables/action_type_config.table";
import {
  TriggerTypeConfig,
  triggerTypeConfigsTableName,
} from "../tables/trigger_type_config.table";

export class TriggerTypeConfigModel extends BasicDataModel(
  TriggerTypeConfig,
  triggerTypeConfigsTableName,
) {
  async getByTypeId(typeId: string): Promise<TriggerTypeConfig | undefined> {
    const results = await this.table
      .filter((doc) => doc.key("typeId").eq(typeId))
      .run();
    return results[0];
  }

  async upsertByTypeId(
    typeId: string,
    patch: Partial<Omit<TriggerTypeConfig, "_id" | "typeId">>,
  ): Promise<void> {
    const existing = await this.getByTypeId(typeId);
    if (existing) {
      await this.update(existing._id, patch);
    } else {
      await this.insert({
        typeId,
        enabled: patch.enabled ?? false,
        config: patch.config ?? "{}",
      });
    }
  }
}

export class ActionTypeConfigModel extends BasicDataModel(
  ActionTypeConfig,
  actionTypeConfigsTableName,
) {
  async getByTypeId(typeId: string): Promise<ActionTypeConfig | undefined> {
    const results = await this.table
      .filter((doc) => doc.key("typeId").eq(typeId))
      .run();
    return results[0];
  }

  async upsertByTypeId(
    typeId: string,
    patch: Partial<Omit<ActionTypeConfig, "_id" | "typeId">>,
  ): Promise<void> {
    const existing = await this.getByTypeId(typeId);
    if (existing) {
      await this.update(existing._id, patch);
    } else {
      await this.insert({
        typeId,
        enabled: patch.enabled ?? false,
        config: patch.config ?? "{}",
      });
    }
  }
}
