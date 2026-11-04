import type { JsonObject } from "@antelopejs/interface-dms-automation";

/** What the fixture's nodes did, in order, for a journey to read back through `GET /verify-auto/ledger`. */
export type LedgerEntry = JsonObject;

export const ledger: LedgerEntry[] = [];

/** Named counters the `verify.flaky` action and the triggers use. */
export const counters = new Map<string, number>();

export function bump(key: string): number {
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return next;
}
