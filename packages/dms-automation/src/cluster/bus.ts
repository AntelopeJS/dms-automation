import { Logging } from "@antelopejs/interface-core/logging";
import { GetClient } from "@antelopejs/interface-redis";
import { instanceId } from "./instance";

type RedisClient = Awaited<ReturnType<typeof GetClient>>;

const CHANNEL = "dms-automation:reconcile";

/** A reconcile signal callers hand to `publish`; `publish` injects `origin`. */
export type ChangeMessage =
  | { kind: "procedure" }
  | { kind: "template-change"; id: string }
  | { kind: "template-delete"; id: string };

/** A `ChangeMessage` on the wire, tagged with the publisher so each instance skips its own echo. */
export type BusMessage = ChangeMessage & { origin: string };

type Handler = (msg: BusMessage) => void;

// Validate a parsed payload before acting on it: a malformed/cross-version
// message (or a channel collision) must not reach applyChange (e.g. delete an
// undefined id) or defeat the self-echo skip with a missing origin.
function isBusMessage(value: unknown): value is BusMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  if (typeof m.origin !== "string") return false;
  if (m.kind === "procedure") return true;
  if (m.kind === "template-change" || m.kind === "template-delete") {
    return typeof m.id === "string";
  }
  return false;
}

let publisher: RedisClient | undefined;
let subscriber: RedisClient | undefined;
let started = false;

/** Subscribe to the reconcile channel. Call once, in redis mode only. */
export async function start(handler: Handler): Promise<void> {
  if (started) return;
  // Claim the slot SYNCHRONOUSLY, before any await, so a concurrent start()
  // can't pass the guard and create a second subscriber (which would deliver
  // every message twice). Rolled back below if init fails, allowing a retry.
  started = true;
  let sub: RedisClient | undefined;
  try {
    const client = await GetClient();
    sub = client.duplicate();
    sub.on("message", (_channel: string, raw: string) => {
      try {
        const msg: unknown = JSON.parse(raw);
        if (!isBusMessage(msg)) {
          Logging.Error(
            "[dms-automation] bus: malformed message dropped:",
            raw,
          );
          return;
        }
        handler(msg);
      } catch (err) {
        Logging.Error("[dms-automation] bus: bad message dropped:", err);
      }
    });
    await sub.subscribe(CHANNEL);
    publisher = client;
    subscriber = sub;
  } catch (err) {
    // Init failed (e.g. redis down at boot). Roll back the claim and tear down
    // the half-created subscriber so a retry can re-init cleanly.
    started = false;
    if (sub) await sub.quit().catch(() => {});
    throw err;
  }
}

/** Fan a reconcile signal out to other instances. No-op (and never throws) until started. */
export async function publish(msg: ChangeMessage): Promise<void> {
  if (!started || !publisher) return;
  try {
    await publisher.publish(
      CHANNEL,
      JSON.stringify({ ...msg, origin: instanceId }),
    );
  } catch (err) {
    Logging.Error("[dms-automation] bus: publish failed (best-effort):", err);
  }
}

export async function close(): Promise<void> {
  if (subscriber) {
    try {
      await subscriber.unsubscribe(CHANNEL);
      await subscriber.quit();
    } catch (err) {
      Logging.Error("[dms-automation] bus: close failed:", err);
    }
  }
  publisher = undefined;
  subscriber = undefined;
  started = false;
}
