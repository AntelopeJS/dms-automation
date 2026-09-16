import { randomUUID } from "node:crypto";

/** Stable identity for this process; used as the leader-lock value and bus message origin. */
export const instanceId = randomUUID();
