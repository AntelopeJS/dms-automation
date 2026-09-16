import {
  Controller,
  Delete,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthUserWithPermission } from "@antelopejs/interface-dms/guards";
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { z } from "zod";
import { ProcedureModel } from "../db/models/procedure.model";
import { ProcedureRunModel } from "../db/models/procedure_run.model";
import { getProceduresSummary } from "../db/models/stats.model";
import { BuilderPageController } from "../pages/builder";
import { ProceduresPageController } from "../pages/procedures";
import { subscriptions } from "../runtime/subscriptions";
import { DATABASE_NAME } from "../types/constants";
import type { ProcedureGraph } from "../types/graph";
import { parseAndValidate, procedureGraphSchema } from "./graphSchema";

const procedureBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
  graph: procedureGraphSchema,
});

function parseProcedureBody(body: unknown): {
  name: string;
  description?: string;
  enabled: boolean;
  graph: ProcedureGraph;
} {
  return parseAndValidate(procedureBodySchema, body, (d) => d.graph);
}

@AuthOwnerOnly()
export class ProceduresController extends Controller(
  "/api/automation/procedures",
) {
  @Get("")
  async list(
    @AuthRawUser() _user: User,
    @Parameter("page", "query") page?: string,
    @Parameter("limit", "query") limit?: string,
  ) {
    const model = GetModel(ProcedureModel, DATABASE_NAME);
    const pageNum = page ? Number(page) : 0;
    const limitNum = limit ? Number(limit) : 20;
    return await model.list({ page: pageNum, limit: limitNum });
  }

  // Per-procedure rows (trigger, status, last run, success, avg) for the
  // Procedures list page. Declared before "/:id" so it isn't captured as an id.
  @Get("/summary")
  async summary(@AuthUserWithPermission(ProceduresPageController) _user: User) {
    return { results: await getProceduresSummary() };
  }

  @Get("/:id")
  async getOne(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const model = GetModel(ProcedureModel, DATABASE_NAME);
    const procedure = await model.get(id);
    if (!procedure) {
      throw new HTTPResult(404, { error: `procedure "${id}" not found` });
    }
    return procedure;
  }

  @Post("")
  async create(
    @AuthUserWithPermission(BuilderPageController) _user: User,
    @JSONBody() body: unknown,
  ) {
    const data = parseProcedureBody(body);
    const model = GetModel(ProcedureModel, DATABASE_NAME);
    const now = new Date();
    const ids = await model.insert({
      name: data.name,
      description: data.description ?? "",
      enabled: data.enabled,
      graph: JSON.stringify(data.graph),
      created_at: now,
      updated_at: now,
    });
    const id = ids[0];
    if (!id) {
      throw new HTTPResult(500, { error: "procedure insert returned no id" });
    }
    await subscriptions.onProcedureChange(id);
    return { _id: id };
  }

  @Put("/:id")
  async update(
    @AuthUserWithPermission(BuilderPageController) _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: unknown,
  ) {
    const data = parseProcedureBody(body);
    const model = GetModel(ProcedureModel, DATABASE_NAME);
    const existing = await model.get(id);
    if (!existing) {
      throw new HTTPResult(404, { error: `procedure "${id}" not found` });
    }
    await model.update(id, {
      name: data.name,
      description: data.description ?? "",
      enabled: data.enabled,
      graph: JSON.stringify(data.graph),
      updated_at: new Date(),
    });
    await subscriptions.onProcedureChange(id);
    return { _id: id };
  }

  @Delete("/:id")
  async remove(
    @AuthUserWithPermission(BuilderPageController) _user: User,
    @Parameter("id", "param") id: string,
  ) {
    const model = GetModel(ProcedureModel, DATABASE_NAME);
    await model.delete(id);
    await subscriptions.onProcedureDelete(id);
    return { _id: id };
  }

  @Post("/:id/run")
  async run(
    @AuthUserWithPermission(BuilderPageController) _user: User,
    @Parameter("id", "param") id: string,
    @JSONBody() body: unknown,
  ) {
    const runId = await subscriptions.invokeManual(id, body);
    return { runId };
  }

  @Get("/:id/runs")
  async runs(
    @AuthRawUser() _user: User,
    @Parameter("id", "param") id: string,
    @Parameter("page", "query") page?: string,
    @Parameter("limit", "query") limit?: string,
  ) {
    const model = GetModel(ProcedureRunModel, DATABASE_NAME);
    const pageNum = page ? Number(page) : 0;
    const limitNum = limit ? Number(limit) : 20;
    // Over-fetch one row so the client can tell whether a next page exists.
    return await model.listByProcedure(id, pageNum, limitNum, true);
  }
}
