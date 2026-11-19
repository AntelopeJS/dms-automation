import { randomUUID } from "node:crypto";
import { Controller, Delete, Get, JSONBody, Parameter, Post } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { RoleModel, UserInviteModel } from "@antelopejs/interface-dms/db";
import {
  DeclareProcedure,
  InvokeProcedure,
  ListActionTypes,
  ListDataNodeTypes,
  ListTriggerTypes,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type ProcedureDeclaration,
  RunProcedure,
  type RunProcedureOptions,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import { bump, counters, ledger } from "./ledger";
import { received, sinkPort } from "./sink";
import { defineType, handles, reregisterType, unregisterType } from "./types";

const INVITE_LIFETIME_MS = 3_600_000;

const memberSchema = z.object({ name: z.string(), permissions: z.array(z.string()) });
const kindSchema = z.enum(["trigger", "action", "data"]);
const jsonSchema = z.custom<JsonSchema>();
const jsonObject = z.custom<JsonObject>();
const jsonValue = z.custom<JsonValue>();
const defineSchema = z.object({
  kind: kindSchema,
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  inputSchema: jsonSchema.optional(),
  outputSchema: jsonSchema.optional(),
  configSchema: jsonSchema.optional(),
  cluster: z.enum(["singleton", "replicated"]).optional(),
  category: z.string().optional(),
  output: jsonObject.optional(),
  sideEffects: z.boolean().optional(),
  dryRunOutput: jsonObject.optional(),
  deactivation: z.enum(["throw-once", "hang-once"]).optional(),
});

const errorDetails = z.object({ status: z.unknown().optional(), body: z.unknown().optional() });

/** What a trusted backend call answered: its result, or the message and status it rejected with. */
async function outcome<T>(call: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; error: string; status: unknown; name: string; body: unknown }> {
  try {
    return { ok: true, result: await call() };
  } catch (error) {
    const details = errorDetails.safeParse(error);
    const status = details.success ? details.data.status : undefined;
    const body = details.success ? details.data.body : undefined;
    return { ok: false, error: error instanceof Error ? error.message : String(error), status, name: error instanceof Error ? error.constructor.name : "non-Error", body };
  }
}

/**
 * Trusted backend calls a journey cannot make over HTTP: the interface's
 * functions, trigger firing, runtime registration, the ledger of what the
 * fixture's nodes did, the HTTP sink's address and members with a role. Only
 * the verification playground serves them.
 */
export class VerifyFixtureController extends Controller("/verify-auto") {
  @Get("/ledger")
  readLedger() {
    return { entries: ledger, counters: Object.fromEntries(counters), received: received.length };
  }

  @Delete("/ledger")
  clearLedger() {
    ledger.length = 0;
    counters.clear();
    received.length = 0;
    return { ok: true };
  }

  @Get("/sink")
  sink() {
    return { base: `http://127.0.0.1:${sinkPort}`, port: sinkPort, received };
  }

  @Get("/handles")
  activeHandles() {
    return { handles: handles.map((handle) => ({ type: handle.type, topic: handle.topic, active: handle.active })) };
  }

  @Post("/emit")
  emit(@JSONBody() body: unknown) {
    const { topic, type, payload, force } = z.object({ topic: z.string(), type: z.string().optional(), payload: jsonValue, force: z.boolean().optional() }).parse(body);
    const targets = handles.filter((handle) => (force === true || handle.active) && handle.topic === topic && (type === undefined || handle.type === type));
    for (const handle of targets) handle.emit(payload);
    return { emitted: targets.length };
  }

  @Post("/invoke")
  invoke(@JSONBody() body: unknown) {
    const { id, payload } = z.object({ id: z.string(), payload: jsonValue.optional() }).parse(body);
    return outcome(() => InvokeProcedure(id, payload));
  }

  @Post("/run")
  run(@JSONBody() body: unknown) {
    const { id, options } = z.object({ id: z.string(), options: z.custom<RunProcedureOptions>().optional() }).parse(body);
    return outcome(() => RunProcedure(id, options));
  }

  @Post("/declare")
  declare(@JSONBody() body: unknown) {
    return outcome(() => DeclareProcedure(z.custom<ProcedureDeclaration>().parse(body)));
  }

  @Get("/types")
  async types() {
    const [triggers, actions, data] = await Promise.all([ListTriggerTypes(), ListActionTypes(), ListDataNodeTypes()]);
    return { triggers: triggers.map((type) => type.id), actions: actions.map((type) => type.id), data: data.map((type) => type.id) };
  }

  @Post("/types/unregister")
  unregister(@JSONBody() body: unknown) {
    const { kind, id } = z.object({ kind: kindSchema, id: z.string() }).parse(body);
    unregisterType(kind, id);
    return { ok: true };
  }

  @Post("/types/register")
  register(@JSONBody() body: unknown) {
    const { kind, id } = z.object({ kind: kindSchema, id: z.string() }).parse(body);
    return { ok: reregisterType(kind, id) };
  }

  @Post("/types/define")
  define(@JSONBody() body: unknown) {
    return { ok: defineType(defineSchema.parse(body)) };
  }

  @Post("/tick/:key")
  tick(@Parameter("key") key: string) {
    return { count: bump(`tick:${key}`) };
  }

  @Post("/member")
  async member(@JSONBody() body: unknown) {
    const { name, permissions } = memberSchema.parse(body);
    const [roleId] = await GetModel(RoleModel, DEFAULT_TENANT_ID).insert({
      name: `${name} ${randomUUID()}`,
      permissions,
    });
    const token = randomUUID();
    const email = `${name.toLowerCase()}-${randomUUID()}@verify.local`;
    await GetModel(UserInviteModel, DEFAULT_TENANT_ID).insert({
      email,
      roles_ids: roleId === undefined ? [] : [roleId],
      language: "en",
      token,
      asTenantOwner: false,
      expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS),
    });
    return { email, token, roleId };
  }
}
