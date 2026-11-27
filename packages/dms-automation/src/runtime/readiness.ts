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
