import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Put,
} from "@antelopejs/interface-api";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { LibraryPageController } from "../pages/library";
import { registry } from "../runtime/registry";
import {
  listWithSwitches,
  serializeAction,
  switchType,
} from "./typeConfigShared";
import type { DataValue } from "../types/dataValue";

@AuthOwnerOnly()
export class ActionTypesController extends Controller(
  "/api/automation/action-types",
) {
  @Get("")
  async list(@AuthRawUser() _user: User) {
    return await listWithSwitches(
      "action",
      registry.listActions(),
      serializeAction,
    );
  }

  @Put("/:id/config")
  async setConfig(
    @AuthUserWithPermission(LibraryPageController) _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: DataValue,
  ) {
    return await switchType("action", registry.getAction(id), id, body);
  }
}
