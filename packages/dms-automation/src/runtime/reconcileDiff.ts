export interface HandleDescriptor {
  typeId: string;
  configHash: string;
}

export interface DiffResult {
  toActivate: string[];
  toDeactivate: string[];
}

/**
 * Pure diff between currently-active subscription handles and the desired set.
 *
 * Keys are of the form `procedureId#nodeId`. A change in either `typeId` or
 * `configHash` for an existing key produces both a deactivation (of the old
 * handle) and an activation (of the new handle) — deactivate-then-activate.
 */
export function diff(
  current: Map<string, HandleDescriptor>,
  desired: Map<string, HandleDescriptor>,
): DiffResult {
  const toActivate: string[] = [];
  const toDeactivate: string[] = [];

  for (const [key, desiredDesc] of desired) {
    const currentDesc = current.get(key);
    if (!currentDesc) {
      toActivate.push(key);
      continue;
    }
    if (
      currentDesc.typeId !== desiredDesc.typeId ||
      currentDesc.configHash !== desiredDesc.configHash
    ) {
      toDeactivate.push(key);
      toActivate.push(key);
    }
  }

  for (const key of current.keys()) {
    if (!desired.has(key)) {
      toDeactivate.push(key);
    }
  }

  return { toActivate, toDeactivate };
}
