/**
 * Whether the module has started: its schema registered and its triggers
 * hydrated. Interface calls that read or write procedures (DeclareProcedure)
 * wait for it, since another module may call them from its own start(),
 * which runs in parallel with ours.
 */

let isStarted = false;
let markStarted: () => void = () => {};
let started: Promise<void> = Promise.resolve();

function resetStarted(): void {
  started = new Promise((resolve) => {
    markStarted = resolve;
  });
}

resetStarted();

export function whenStarted(): Promise<void> {
  return started;
}

export function markModuleStarted(): void {
  isStarted = true;
  markStarted();
}

/**
 * After destroy(): calls wait again for the next start(). Calls already
 * waiting keep waiting on the same promise.
 */
export function markModuleStopped(): void {
  if (!isStarted) return;
  isStarted = false;
  resetStarted();
}
