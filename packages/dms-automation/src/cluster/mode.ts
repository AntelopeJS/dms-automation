import { GetInterfaceInstances } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";

export type ClusterDriver = "auto" | "redis" | "memory";
export type ClusterMode = "redis" | "memory";

const REDIS_INTERFACE_ID = "@antelopejs/interface-redis";

function redisAvailable(): boolean {
  try {
    return GetInterfaceInstances(REDIS_INTERFACE_ID).length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve the effective cluster mode once, after interfaces are wired.
 *   "auto"   → redis if the interface is provided, else memory
 *   "redis"  → force redis; if absent, warn and fall back to memory
 *   "memory" → force standalone (today's behavior)
 */
export function resolveClusterMode(
  driver: ClusterDriver = "auto",
): ClusterMode {
  if (driver === "memory") return "memory";
  const available = redisAvailable();
  if (driver === "redis" && !available) {
    Logging.Warn(
      "[dms-automation] cluster.driver=redis but @antelopejs/interface-redis is not provided; falling back to standalone (memory) mode",
    );
    return "memory";
  }
  return available ? "redis" : "memory";
}
