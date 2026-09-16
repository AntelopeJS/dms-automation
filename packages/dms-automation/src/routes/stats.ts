import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { getStatsSnapshot } from "../db/models/stats.model";

@AuthOwnerOnly()
export class StatsController extends Controller("/api/automation/stats") {
  @Get("")
  async snapshot(@AuthRawUser() _user: User) {
    return await getStatsSnapshot();
  }
}
