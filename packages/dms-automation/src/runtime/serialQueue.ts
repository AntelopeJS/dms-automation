/**
 * Operations run one after the other, each after the previous one SETTLES
 * (success or failure), so one failure never wedges the queue.
 */
export interface SerialQueue {
  /**
   * Queue `op`. The returned promise reflects THIS operation's real outcome
   * — it may reject — so callers can react; the queue itself swallows it.
   */
  run(op: () => Promise<void>): Promise<void>;
  /**
   * Queue `op` unless a request is already queued and not started yet: a
   * burst of requests shares one run. Never rejects: failures go to
   * `onError`.
   */
  request(op: () => Promise<void>, onError: (err: unknown) => void): void;
}

export function serialQueue(): SerialQueue {
  let chain: Promise<void> = Promise.resolve();
  let requested = false;
  const run = (op: () => Promise<void>): Promise<void> => {
    const next = chain.then(op, op);
    chain = next.catch(() => {});
    return next;
  };
  return {
    run,
    request(op, onError) {
      if (requested) return;
      requested = true;
      run(() => {
        requested = false;
        return op();
      }).catch(onError);
    },
  };
}
