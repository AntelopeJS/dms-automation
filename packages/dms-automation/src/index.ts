import "./db";
import "./pages";
import "./routes";
import path from "node:path";
import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import { RegisterSchema } from "@antelopejs/interface-database-decorators";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import {
  RegisterActionType,
  RegisterDataNodeType,
  RegisterTriggerType,
} from "@antelopejs/interface-dms-automation";
import { defu } from "defu";
import * as bus from "./cluster/bus";
import { instanceId } from "./cluster/instance";
import * as leader from "./cluster/leader";
import type { ClusterDriver } from "./cluster/mode";
import { resolveClusterMode } from "./cluster/mode";
import {
  builtinActions,
  builtinDataNodes,
  builtinTriggers,
} from "./runtime/builtins";
import { registry } from "./runtime/registry";
import { subscriptions } from "./runtime/subscriptions";
import { isOriginAttributionWorking } from "./runtime/typeOrigin";
import { MODULE_NAME, SCHEMA_NAME } from "./types/constants";

export interface Config {
  /** Multi-instance coordination. Omit for standalone (single-instance) behavior. */
  cluster?: { driver?: ClusterDriver };
}

let globalConfig: Config = {};

export async function construct(config: Config): Promise<void> {
  globalConfig = defu(config, globalConfig);

  ImplementInterface(
    await import("@antelopejs/interface-dms-automation"),
    await import("./implementations/dms-automation"),
  );

  await AddFrontendModule({
    name: MODULE_NAME,
    sourcePath: path.join(__dirname, "../frontend-vue"),
    renderer: { name: "vue", version: "3" },
    configKey: "dmsAutomation",
    options: { authHeaderName: "x-dashboard-auth" },
    priority: 0,
  });
}

export function getConfig(): Config {
  return globalConfig;
}

// Register the built-in trigger/action/data-node types before bootstrap, so any
// active procedures using them reconcile against a populated registry.
function registerBuiltins(): void {
  for (const t of builtinTriggers) RegisterTriggerType(t);
  for (const a of builtinActions) RegisterActionType(a);
  for (const dn of builtinDataNodes) RegisterDataNodeType(dn);
  Logging.Info(
    "[dms-automation] registered built-ins:",
    registry.listTriggers().map((t) => t.id),
    registry.listActions().map((a) => a.id),
    registry.listDataNodes().map((d) => d.id),
  );

  // We just registered these ourselves, so attribution MUST resolve them back
  // to us. If it doesn't, the interface's registration bookkeeping changed
  // shape and the palette silently stops grouping by module (everything lands
  // in the unlabeled built-in section) — which is indistinguishable from
  // "no other module registered anything". Say so out loud instead.
  const probe = builtinTriggers[0];
  if (probe && !isOriginAttributionWorking(probe.id)) {
    Logging.Warn(
      "[dms-automation] type-origin attribution unavailable — the builder palette won't group catalog entries by module",
    );
  }
}

// Redis-mode setup that must run BEFORE hydrate: subscribe to the reconcile
// channel before hydrate so a peer edit committed during our boot isn't missed
// (pub/sub is at-most-once, no replay).
async function startClusterSubscriber(): Promise<void> {
  await bus.start((msg) => void subscriptions.onBusMessage(msg));
}

// Redis-mode setup that runs AFTER hydrate: contend for leadership; winning
// promotes us and reconciles the singleton triggers hydrate skipped.
async function startLeaderElection(): Promise<void> {
  await leader.start({
    onBecameLeader: () => subscriptions.onBecameLeader(),
    onLostLeadership: () => subscriptions.onLostLeadership(),
  });
  Logging.Info(`[dms-automation] cluster mode: redis (instance ${instanceId})`);
}

export async function start(): Promise<void> {
  await RegisterSchema(SCHEMA_NAME);
  registerBuiltins();

  const mode = resolveClusterMode(globalConfig.cluster?.driver);
  // Set the leadership gate explicitly on EVERY boot so a restart can't inherit
  // a stale source (e.g. a redis run left it pointing at leader.isLeader, which
  // stays false after stop() — a later memory-mode boot would then run as a
  // permanent follower). Redis reads the live lock; standalone is always leader.
  subscriptions.useLeadershipSource(
    mode === "redis" ? leader.isLeader : () => true,
  );
  if (mode === "redis") await startClusterSubscriber();

  // In redis mode this brings up replicated triggers only (follower).
  await subscriptions.hydrate();

  if (mode === "redis") await startLeaderElection();
  else Logging.Info("[dms-automation] cluster mode: standalone (memory)");
}

export async function destroy(): Promise<void> {
  // Release leadership first (fast handoff), then the bus, then local handles.
  await leader.stop();
  await bus.close();
  await subscriptions._deactivateAll();
}

export function stop(): void {}
