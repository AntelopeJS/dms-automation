import "./db";
import "./pages";
import "./routes";
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
import { configureRedaction } from "./runtime/boundRunLog";
import { setHttpRequestOptions } from "./runtime/builtins/actions/http";
import {
  builtinActions,
  builtinDataNodes,
  builtinTriggers,
} from "./runtime/builtins";
import { markModuleStarted, markModuleStopped } from "./runtime/readiness";
import { registry } from "./runtime/registry";
import {
  configureRetention,
  startRetention,
  stopRetention,
} from "./runtime/retention";
import { subscriptions } from "./runtime/subscriptions";
import { isOriginAttributionWorking } from "./runtime/typeOrigin";
import { SCHEMA_NAME } from "./types/constants";
import { frontendModule } from "./frontend-module";

export interface Config {
  /** Multi-instance coordination. Omit for standalone (single-instance) behavior. */
  cluster?: { driver?: ClusterDriver };
  runs?: {
    /**
     * Days a run is kept before it is deleted, 30 by default. `0` keeps every
     * run.
     */
    retentionDays?: number;
    /**
     * More header and query parameter names whose value is a credential,
     * matched case-insensitively as part of the name (e.g. "x-shop-secret").
     * Added to the built-in list (Authorization, Cookie, *token*, *secret*,
     * *signature*, *hmac*, *-key…).
     */
    sensitiveNames?: string[];
  };
  /** The built-in HTTP request action. */
  httpRequest?: {
    /**
     * Refuse requests to loopback, private and link-local addresses (this
     * server's network, cloud metadata endpoints). Off by default.
     */
    blockPrivateNetwork?: boolean;
  };
}

let globalConfig: Config = {};

export async function construct(config: Config): Promise<void> {
  globalConfig = defu(config, globalConfig);
  configureRetention(globalConfig.runs?.retentionDays);
  configureRedaction(globalConfig.runs?.sensitiveNames);
  setHttpRequestOptions(globalConfig.httpRequest ?? {});

  ImplementInterface(
    await import("@antelopejs/interface-dms-automation"),
    await import("./implementations/dms-automation"),
  );

  await AddFrontendModule(frontendModule());
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

  startRetention(mode === "redis" ? leader.isLeader : () => true);
  markModuleStarted();
}

export async function destroy(): Promise<void> {
  markModuleStopped();
  stopRetention();
  // Release leadership first (fast handoff), then the bus, then local handles.
  await leader.stop();
  await bus.close();
  await subscriptions._deactivateAll();
}

export function stop(): void {}
