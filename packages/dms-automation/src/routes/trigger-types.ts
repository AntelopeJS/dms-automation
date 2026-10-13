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
  serializeTrigger,
  switchType,
} from "./typeConfigShared";

@AuthOwnerOnly()
export class TriggerTypesController extends Controller(
  "/api/automation/trigger-types",
) {
  @Get("")
  async list(@AuthRawUser() _user: User) {
    return await listWithSwitches(
      "trigger",
      registry.listTriggers(),
      serializeTrigger,
    );
  }

  @Put("/:id/config")
  async setConfig(
    @AuthUserWithPermission(LibraryPageController) _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: unknown,
  ) {
    return await switchType("trigger", registry.getTrigger(id), id, body);
  }
}
