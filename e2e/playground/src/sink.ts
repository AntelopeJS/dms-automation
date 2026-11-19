import { createServer } from "node:http";
import type { JsonObject } from "@antelopejs/interface-dms-automation";
import { z } from "zod";

/** Where the sink listens, once `startSink` ran. */
export let sinkPort = 0;

/** The requests the sink received, newest last. */
export const received: JsonObject[] = [];

const listening = z.object({ port: z.number() });
const BIG_DEFAULT = 1024;

/**
 * A plain HTTP server on a free loopback port that the HTTP request action
 * calls: it echoes what it received and can answer a given status, redirect,
 * a body of a given size, or slowly. It answers every method.
 */
export function startSink(): void {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://sink");
      const body = Buffer.concat(chunks);
      received.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: request.headers, body: body.toString("utf8") });
      const [, kind, argument] = url.pathname.split("/");
      if (kind === "status") {
        response.writeHead(Number(argument), { "content-type": "text/plain" });
        response.end(url.searchParams.get("body") ?? "");
        return;
      }
      if (kind === "redirect") {
        const hops = Number(argument);
        const to = hops > 1 ? `/redirect/${hops - 1}` : (url.searchParams.get("to") ?? "/echo");
        response.writeHead(Number(url.searchParams.get("code") ?? 302), { location: to });
        response.end();
        return;
      }
      if (kind === "big") {
        const size = Number(argument ?? BIG_DEFAULT);
        response.writeHead(200, { "content-type": "text/plain", "content-length": size });
        response.end(Buffer.alloc(size, 0x61));
        return;
      }
      if (kind === "slow") {
        setTimeout(() => {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("late");
        }, Number(argument));
        return;
      }
      if (kind === "text") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(url.searchParams.get("body") ?? "plain");
        return;
      }
      if (kind === "chunked") {
        const size = Number(argument ?? BIG_DEFAULT);
        response.writeHead(200, { "content-type": "text/plain" });
        response.write(Buffer.alloc(Math.floor(size / 2), 0x62));
        response.end(Buffer.alloc(size - Math.floor(size / 2), 0x62));
        return;
      }
      if (kind === "ctype") {
        response.writeHead(200, { "content-type": url.searchParams.get("type") ?? "text/plain", "set-cookie": "session=abc123; Path=/", "x-api-key": "server-secret" });
        response.end(url.searchParams.get("body") ?? "");
        return;
      }
      if (kind === "reset") {
        request.socket.destroy();
        return;
      }
      if (kind === "badjson") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{not json");
        return;
      }
      response.writeHead(200, { "content-type": "application/json", "x-sink": "1" });
      response.end(JSON.stringify({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: request.headers, body: body.toString("utf8") }));
    });
  });
  server.listen(0, "127.0.0.1", () => {
    const address = listening.safeParse(server.address());
    if (address.success) sinkPort = address.data.port;
  });
}
