import type { RegisteringProxy } from "@antelopejs/interface-core";
import { GetResponsibleModule } from "@antelopejs/interface-core";
import { internal } from "@antelopejs/interface-dms-automation";

/**
 * Resolves which AntelopeJS module registered each trigger/action/data-node
 * type, so the editor's palette can group catalog entries by their module of
 * origin (this module's own types — the built-in ones — first).
 *
 * The interface's RegisteringProxy already records the responsible module for
 * every register() call (it needs that to auto-unregister a module's entries
 * when the module unloads) but does not forward it to the register callback,
 * and it replays queued registrations from OUR stack once we attach — so the
 * callback can't recover the true caller. That leaves the proxy's private
 * `registered` map as the only complete source. The cast below is deliberately
 * narrow and the access is fully defensive: if a future
 * @antelopejs/interface-core renames the field, every lookup degrades to "no
 * module" (a flat, ungrouped palette) instead of throwing.
 * `isOriginAttributionWorking` turns that silent degradation into a boot-time
 * warning — see src/index.ts.
 */
interface ProxyRegistryEntry {
  module?: string;
}
interface ProxyRegistry {
  registered?: Map<string, ProxyRegistryEntry>;
}

/**
 * This module's own id in the host project (the config key naming us, e.g.
 * "dms-automation" in the playground — deployments may pick another name).
 * Captured at import time, while the call stack is unambiguously inside this
 * module; inside a request handler the responsible module would be the api
 * module instead.
 */
const SELF_MODULE = GetResponsibleModule();

export interface TypeOrigin {
  /**
   * Id of the AntelopeJS module that registered the type — set only for types
   * coming from ANOTHER module. Omitted for our own built-ins (and for types
   * we couldn't attribute), which the palette lists first, unlabeled.
   */
  module?: string;
}

function originOf(proxy: RegisteringProxy, id: string): TypeOrigin {
  // Reaching into an AntelopeJS internal: the runtime's registry is
  // not on the public type, and the source and target do not overlap,
  // so a single assertion is not expressible.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  const module = (proxy as unknown as ProxyRegistry).registered?.get(
    id,
  )?.module;
  return module === undefined || module === SELF_MODULE ? {} : { module };
}

export const triggerTypeOrigin = (id: string): TypeOrigin =>
  originOf(internal.RegisterTriggerType, id);

export const actionTypeOrigin = (id: string): TypeOrigin =>
  originOf(internal.RegisterActionType, id);

export const dataNodeTypeOrigin = (id: string): TypeOrigin =>
  originOf(internal.RegisterDataNodeType, id);

/**
 * Boot-time canary: attribution is working iff a trigger type we registered
 * ourselves resolves back to our own module id. Without this probe a broken
 * lookup is invisible — every external module's types silently land in the
 * unlabeled built-in section, which looks exactly like "no external modules
 * installed".
 */
export function isOriginAttributionWorking(ownTriggerTypeId: string): boolean {
  if (SELF_MODULE === undefined) return false;
  // Reaching into an AntelopeJS internal: the runtime's registry is
  // not on the public type, and the source and target do not overlap,
  // so a single assertion is not expressible.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  const registry = internal.RegisterTriggerType as unknown as ProxyRegistry;
  return registry.registered?.get(ownTriggerTypeId)?.module === SELF_MODULE;
}
