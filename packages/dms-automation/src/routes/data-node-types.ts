import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { registry } from "../runtime/registry";
import { serializeDataNode } from "./typeConfigShared";

@AuthOwnerOnly()
export class DataNodeTypesController extends Controller(
  "/api/automation/data-node-types",
) {
  @Get("")
  async list(@AuthRawUser() _user: User) {
    return registry.listDataNodes().map(serializeDataNode);
  }
}
