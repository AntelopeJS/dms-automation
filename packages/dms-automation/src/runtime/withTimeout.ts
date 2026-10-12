/**
 * `p`, rejected after `ms` when it has not settled by then: an operation
 * that hangs (a trigger's activate or deactivate) cannot block its caller.
 */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`[dms-automation] ${label} timed out after ${ms}ms`)),
      ms,
    );
    // Don't let the fallback timer keep the event loop alive — otherwise a hung
    // trigger teardown could hold the process open for up to `ms` on shutdown.
    timer.unref?.();
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
