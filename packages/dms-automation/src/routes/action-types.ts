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
import { ActionTypeConfigModel } from "../db/models/type_config.model";
import { LibraryPageController } from "../pages/library";
import { registry } from "../runtime/registry";
import { DATABASE_NAME } from "../types/constants";
import { parseConfigBody, serializeAction } from "./typeConfigShared";

@AuthOwnerOnly()
export class ActionTypesController extends Controller(
  "/api/automation/action-types",
) {
  @Get("")
  async list(@AuthRawUser() _user: User) {
    const model = GetModel(ActionTypeConfigModel, DATABASE_NAME);
    const actions = registry.listActions();
    return Promise.all(
      actions.map(async (a) => {
        const cfg = await model.getByTypeId(a.id);
        return {
          ...serializeAction(a),
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
    const model = GetModel(ActionTypeConfigModel, DATABASE_NAME);
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
    const model = GetModel(ActionTypeConfigModel, DATABASE_NAME);
    await model.upsertByTypeId(id, parseConfigBody(body));
    return { id };
  }
}
