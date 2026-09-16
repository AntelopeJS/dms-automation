import {
  Controller,
  Get,
  HTTPResult,
  Parameter,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import { DATABASE_NAME, MS_PER_DAY, MS_PER_HOUR } from "../types/constants";

// Period unit ("h" / "d") to its span in milliseconds.
const MS_PER_UNIT: Record<"h" | "d", number> = {
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
};

function sinceFromPeriod(period?: string): Date | undefined {
  if (!period) return undefined;
  const m = /^(\d+)([hd])$/.exec(period);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2] as "h" | "d";
  return new Date(Date.now() - n * MS_PER_UNIT[unit]);
}

@AuthOwnerOnly()
export class RunsController extends Controller("/api/automation/runs") {
  @Get("")
  // Each parameter is bound to a request input by its decorator, so
  // the framework hands them in positionally: an options object is not
  // expressible here.
  // oxlint-disable-next-line eslint/max-params
  async list(
    @AuthRawUser() _user: User,
    @Parameter("page", "query") page?: string,
    @Parameter("limit", "query") limit?: string,
    @Parameter("procedureId", "query") procedureId?: string,
    @Parameter("status", "query") status?: string,
    @Parameter("period", "query") period?: string,
  ) {
    const model = GetModel(ProcedureRunModel, DATABASE_NAME);
    const normalizedStatus =
      status === "ok" || status === "failed" ? status : undefined;
    return model.listAll({
      page: parseInt(page ?? "0", 10),
      limit: parseInt(limit ?? "50", 10),
      procedureId,
      status: normalizedStatus,
      since: sinceFromPeriod(period),
      // Over-fetch one row so the client can tell whether a next page exists.
      peek: true,
    });
  }

  @Get("/:id")
  async getOne(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const model = GetModel(ProcedureRunModel, DATABASE_NAME);
    const run = await model.get(id);
    if (!run) {
      throw new HTTPResult(404, { error: `run "${id}" not found` });
    }
    return run;
  }
}
