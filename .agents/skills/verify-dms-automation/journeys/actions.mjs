import { guarded } from "../guard.mjs";
import { ACTION_ENTRIES, openLibrary, showEntries } from "./parts/runtime-library-wording.mjs";
import { contextChecks, logChecks, outputChecks, throwChecks, typeStateChecks } from "./parts/actions-core.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

import { answerChecks, fieldChecks, requestChecks } from "./parts/http-requests.mjs";
import { blockedChecks, namedHostChecks, openChecks } from "./parts/http-private.mjs";
import { sinkBase } from "./parts/http-kit.mjs";
import { withConfig } from "../procs.mjs";
import { defaultTimeoutChecks, excerptChecks, limitChecks, networkChecks, statusChecks, urlChecks } from "./parts/http-failures.mjs";

const ENTRY = "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id, GET /runs/:id/logs";
const HTTP_ENTRY = "POST /procedures/import, POST /procedures/:id/run-now, GET /runs/:id, GET /verify-auto/sink";

export const journeys = guarded([
  {
    id: "log-writes-its-message-and-value-to-the-run-and-the-server-log",
    title: "Log writes its message and an optional structured value at info, warn or error (info by default) to the run's Logs and to the backend log, and hands both on as its output",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("Log", await logChecks(ctx));
    },
  },
  {
    id: "an-action-sees-its-ids-and-logs-through-ctx",
    title: "An action receives procedureId, runId, nodeId and dryRun in its execution context, and ctx.log records the level, message and JSON value against its node",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("ctx", await contextChecks(ctx));
    },
  },
  {
    id: "an-action-resolves-with-an-object-or-nothing",
    title: "An action that resolves with an object makes its fields available downstream, one that resolves with nothing leaves the step without output, anything else (an array, a text) fails the step",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("outputs", await outputChecks(ctx));
    },
  },
  {
    id: "a-throw-fails-the-step-whatever-was-thrown",
    title: "An action that throws fails its step and the run with the error's message; a thrown text, number, object, null, undefined, empty text or list reads as its text",
    entryPoint: ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("throws", await throwChecks(ctx));
    },
  },
  {
    id: "a-step-of-a-disabled-or-unregistered-action-type-fails",
    title: "A step whose action type is disabled in the library fails with \"action type is disabled in the library\"; one whose type is not registered is refused with the node and the type named",
    entryPoint: "PUT /action-types/:id/config, " + ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("type state", await typeStateChecks(ctx));
    },
  },
  {
    id: "the-library-describes-the-built-in-actions",
    title: "The Library's Actions tab lists HTTP request, which fails outside 200-299, and Log, which writes a message and an optional value to the run log",
    entryPoint: "/modules/automation/library?tab=actions",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openLibrary(ctx, "actions", /HTTP request/);
      await ctx.verify("the entries", await showEntries(tab, ACTION_ENTRIES));
    },
  },
  {
    id: "http-request-sends-the-method-headers-and-body-it-is-given",
    title: "HTTP request sends GET, POST, PUT, DELETE or PATCH (GET by default) with its headers; an object body goes as JSON, a text body as it is, and GET ignores a body with a warning",
    entryPoint: HTTP_ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("requests", await requestChecks(ctx));
    },
  },
  {
    id: "http-request-hands-on-status-headers-body-and-parsed-json",
    title: "HTTP request outputs the status, the headers, the body as text and the body parsed when the server says it is JSON; credentials in headers are masked in the run",
    entryPoint: HTTP_ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("answers", await answerChecks(ctx));
    },
  },
  {
    id: "http-request-publishes-its-fields-and-defaults",
    title: "HTTP request has the URL as its only required field, GET as default method, a 30000 ms timeout between 1 and 300000, fail on status on by default",
    entryPoint: "GET /action-types",
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("fields", await fieldChecks(ctx));
    },
  },
  {
    id: "http-request-fails-outside-200-299-and-says-what-to-check",
    title: "HTTP request fails the step on a status outside 200-299 with the request, the status, a hint and the start of the response; failOnStatus off hands the status over instead",
    entryPoint: HTTP_ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("statuses", await statusChecks(ctx));
      await ctx.verify("quoted responses", await excerptChecks(ctx));
    },
  },
  {
    id: "http-request-says-in-words-why-it-got-no-answer",
    title: "HTTP request says in words when a port is closed, a host is unknown, a connection is cut or the timeout passed",
    entryPoint: HTTP_ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("network", await networkChecks(ctx));
    },
  },
  {
    id: "http-request-refuses-urls-and-headers-it-cannot-use",
    title: "HTTP request refuses an empty or invalid URL, a scheme other than http and https, and headers that are not an object of names and values",
    entryPoint: HTTP_ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("inputs", await urlChecks(ctx));
    },
  },
  {
    id: "http-request-caps-the-timeout-at-5-minutes-and-the-response-at-2-mb",
    title: "A response of 2 MB is accepted and one byte more is refused, a timeout above 5 minutes is capped and the run log says so",
    entryPoint: HTTP_ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("limits", await limitChecks(ctx));
    },
  },
  {
    id: "http-request-waits-30-seconds-by-default",
    title: "A request with no timeoutMs waits 30 seconds for the answer",
    entryPoint: HTTP_ENTRY,
    async run(/** @type {Ctx} */ ctx) {
      await ctx.verify("default timeout", await defaultTimeoutChecks(ctx));
    },
  },
  {
    id: "block-private-network-refuses-every-internal-address-range",
    title: "With httpRequest.blockPrivateNetwork on, a request to loopback, unspecified, private, carrier-grade NAT, link-local, multicast, reserved or NAT64-embedded addresses fails naming the host and the address, and addresses next to those ranges are let through",
    entryPoint: "VERIFY_AUTO_BLOCK_PRIVATE=1, POST /procedures/:id/run-now, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const base = await sinkBase(ctx);
      await withConfig(ctx, { VERIFY_AUTO_BLOCK_PRIVATE: "1" }, async () => {
        await ctx.verify("refused addresses", await blockedChecks(ctx));
        await ctx.verify("addresses next to the ranges", await openChecks(ctx));
        await ctx.verify("named hosts", await namedHostChecks(ctx, base));
      });
    },
  },
]);
