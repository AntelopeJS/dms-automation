import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Put,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TriggerTypeConfigModel } from "../db/models/type_config.model";
import { LibraryPageController } from "../pages/library";
import { registry } from "../runtime/registry";
import { DATABASE_NAME } from "../types/constants";
import { parseConfigBody, serializeTrigger } from "./typeConfigShared";

@AuthOwnerOnly()
export class TriggerTypesController extends Controller(
  "/api/automation/trigger-types",
) {
  @Get("")
  async list(@AuthRawUser() _user: User) {
    const model = GetModel(TriggerTypeConfigModel, DATABASE_NAME);
    const triggers = registry.listTriggers();
    return Promise.all(
      triggers.map(async (t) => {
        const cfg = await model.getByTypeId(t.id);
        return {
          ...serializeTrigger(t),
          globalConfig: cfg?.config ?? "{}",
          enabled: cfg?.enabled ?? true,
        };
      }),
    );
  }

  @Get("/:id/config")
  async getConfig(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const model = GetModel(TriggerTypeConfigModel, DATABASE_NAME);
    const cfg = await model.getByTypeId(id);
    if (!cfg) {
      return { enabled: true, config: "{}" };
    }
    return { enabled: cfg.enabled, config: cfg.config };
  }

  @Put("/:id/config")
  async setConfig(
    @AuthUserWithPermission(LibraryPageController) _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: unknown,
  ) {
    const model = GetModel(TriggerTypeConfigModel, DATABASE_NAME);
    await model.upsertByTypeId(id, parseConfigBody(body));
    return { id };
  }
}
