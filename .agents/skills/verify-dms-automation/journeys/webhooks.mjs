import { guarded } from "../guard.mjs";
import { auto, list, pick, same, text } from "../auto.mjs";
import { action, createProcedure, graph, statusIs, tedge, trigger } from "../procs.mjs";
import { enabledProcedure, issueLines, issuesOf, saveGraph, webhookGraph } from "./parts/triggers-common.mjs";
import { overlapJourneys } from "./parts/webhooks-overlap.mjs";
import { callJourneys } from "./parts/webhooks-calls.mjs";
import { pageJourneys } from "./parts/webhooks-pages.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */
/** @typedef {import("../auto.mjs").Check} Check */

const INVALID = (/** @type {string} */ path) => `error webhookPathInvalid webhook path must start with "/" and use only letters, digits and - . _ ~ : / (got ${JSON.stringify(path)})`;
const RESERVED = (/** @type {string} */ path) => `error webhookPathReserved webhook path ${path} is reserved for the API`;

const VALID_PATHS = ["/a", "/", "/webhooks/x", "/a-b.c_d~e:f/g", "/a/b/", " /a ", "/apix", "/api-v2", "/apis", "/authz", "/dmsx", "/module", "/setting", "/modulesx", "/webhooks/api", "/x/api", "/:id", "/a/:b/c", "/123", "/A-Z", "/a/.b", "/a/..b", "/a/b.", "/...", "/a:b", "/a_b", "/a~b"];
const INVALID_PATHS = ["a", "webhooks/x", "/a b", "/a//b", "//a", "/a/./b", "/./a", "/a/.", "/a/..", "/..", "/.", "/a/../b", "/é", "/日本", "/a?b=1", "/a#b", "/a%20b", "/a\\b", "/a*b", "/a@b", "/a😀", "/a,b", "/a;b", "/a(b)", "/a+b", "/a=b", "/a&b", "/a'b", "/a\"b", "/a\tb"];
const RESERVED_PATHS = ["/api", "/api/x", "/api/", "/auth", "/auth/login", "/dms", "/dms/x", "/modules", "/modules/automation/overview", "/settings", "/settings/a/b", "/API/x"];

export const journeys = guarded([
  {
    id: "webhook-paths-follow-the-documented-rules",
    title: "a webhook path must start with / and use only letters, digits and - . _ ~ : /, hold no empty, . or .. segment and not be /api, /auth, /dms, /modules or /settings or sit under one; an invalid path is refused when enabling with the documented message",
    entryPoint: "POST /procedures/validate, POST /procedures/import, PUT /procedures/:id/enabled",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {[string, string[]][]} */
      const valid = [];
      for (const path of VALID_PATHS) valid.push([path, issueLines(await issuesOf(ctx, webhookGraph(path), { enabled: true }))]);
      await ctx.verify("valid paths raise no problem", valid.map(([path, lines]) => same(`path ${JSON.stringify(path)}`, lines, [])));
      /** @type {[string, string[]][]} */
      const invalid = [];
      for (const path of INVALID_PATHS) invalid.push([path, issueLines(await issuesOf(ctx, webhookGraph(path), { enabled: true }))]);
      await ctx.verify("invalid characters and segments are refused with the documented message", invalid.map(([path, lines]) => same(`path ${JSON.stringify(path)}`, lines, [INVALID(path)])));
      /** @type {[string, string[]][]} */
      const reserved = [];
      for (const path of RESERVED_PATHS) reserved.push([path, issueLines(await issuesOf(ctx, webhookGraph(path), { enabled: true }))]);
      await ctx.verify("the reserved prefixes and what sits under them are refused", reserved.map(([path, lines]) => same(`path ${JSON.stringify(path)}`, lines, [RESERVED(path)])));

      const notAString = issueLines(await issuesOf(ctx, graph([trigger("t", "webhook", { path: 5 }), action("log", "log.message", { message: "x" })], [tedge("t", "log")]), { enabled: true }));
      const missing = issueLines(await issuesOf(ctx, graph([trigger("t", "webhook", {}), action("log", "log.message", { message: "x" })], [tedge("t", "log")]), { enabled: true }));
      const missingDraft = issueLines(await issuesOf(ctx, graph([trigger("t", "webhook", {}), action("log", "log.message", { message: "x" })], [tedge("t", "log")]), { enabled: false }));
      await ctx.verify("a path that is not text or is missing", [
        same("a number is not a path", notAString, ["error webhookPathInvalid webhook path must start with \"/\" and use only letters, digits and - . _ ~ : / (got 5)"]),
        same("a missing path blocks enabling", missing, ["error missingField Path is empty"]),
        same("a missing path only warns on a draft", missingDraft, ["warning missingField Path is empty"]),
      ]);

      /** @type {[string, string[]][]} */
      const methods = [];
      for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) methods.push([method, issueLines(await issuesOf(ctx, webhookGraph("/m", method), { enabled: true }))]);
      for (const method of ["HEAD", "OPTIONS", "post", "get", "Post", "TRACE"]) methods.push([method, issueLines(await issuesOf(ctx, webhookGraph("/m", method), { enabled: true }))]);
      await ctx.verify("the method is GET, POST, PUT, DELETE or PATCH", methods.map(([method, lines]) => (["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method) ? same(`method ${method}`, lines, []) : same(`method ${JSON.stringify(method)}`, lines, [`error notInEnum Method cannot be ${JSON.stringify(method)}`]))));

      const bad = await createProcedure(ctx, { name: ctx.unique("Bad path"), graph: webhookGraph("/a b") });
      const read = await auto(ctx, "read the draft", "GET", `/procedures/${bad}`);
      const refused = await auto(ctx, "enable the invalid path", "PUT", `/procedures/${bad}/enabled`, { body: { enabled: true } });
      const after = await auto(ctx, "read the draft again", "GET", `/procedures/${bad}`);
      await ctx.verify("enabling an invalid path is refused and the draft stays disabled", [
        same("the import is a disabled draft", pick(read.body, "enabled"), false),
        statusIs(refused, 400, "enabling answers 400"),
        same("the refusal message", text(refused.body, "message"), "$dms_automation.api.graphHasErrors"),
        same("the refusal lists the problem", issueLines(list(refused.body, "issues")), [INVALID("/a b")]),
        same("it is still disabled", pick(after.body, "enabled"), false),
      ]);
    },
  },
  {
    id: "a-webhook-on-the-same-route-as-an-enabled-procedure-is-refused",
    title: "a webhook is refused when another enabled procedure has a webhook with the same method on the same path (a trailing slash makes no difference), a paused procedure frees its path, and a duplicate moves its webhooks to free paths",
    entryPoint: "POST /procedures/validate, PUT /procedures/:id/enabled, POST /procedures/:id/duplicate",
    async run(/** @type {Ctx} */ ctx) {
      const owner = ctx.unique("Owner");
      const { id: ownerId, enabled } = await enabledProcedure(ctx, { name: owner, graph: webhookGraph("/webhooks/o/fixed") });
      await ctx.verify("the owner is enabled", [statusIs(enabled, 200, "enabling the owner answers 200")], { critical: true });
      const taken = (/** @type {string} */ path, /** @type {string} */ method = "POST") => `error webhookPathTaken ${method} ${path} already answers for the procedure "${owner}"`;
      /** @type {[string, string | undefined, string[]][]} */
      const cases = [
        ["/webhooks/o/fixed", undefined, [taken("/webhooks/o/fixed")]],
        ["/webhooks/o/fixed/", undefined, [taken("/webhooks/o/fixed")]],
        ["/webhooks/o/fixed", "POST", [taken("/webhooks/o/fixed")]],
        ["/webhooks/o/fixed/x", undefined, []],
        ["/webhooks/o", undefined, []],
        ["/webhooks/p/fixed", undefined, []],
        ["/webhooks/o/Fixed", undefined, []],
        ["/webhooks/o/fixed", "GET", []],
        ["/webhooks/o/fixed", "PUT", []],
        ["/webhooks/o/fixed", "DELETE", []],
        ["/webhooks/o/fixed", "PATCH", []],
      ];
      /** @type {[string, string | undefined, string[], string[]][]} */
      const results = [];
      for (const [path, method, expected] of cases) results.push([path, method, expected, issueLines(await issuesOf(ctx, webhookGraph(path, method), { enabled: true }))]);
      await ctx.verify("only the same method on the same path is refused, with the owner named", results.map(([path, method, expected, lines]) => same(`${method ?? "POST"} ${path}`, lines, expected)));

      const draft = issueLines(await issuesOf(ctx, webhookGraph("/webhooks/o/fixed"), { enabled: false }));
      const own = issueLines(await issuesOf(ctx, webhookGraph("/webhooks/o/fixed"), { enabled: true, procedureId: ownerId }));
      await ctx.verify("a draft only gets a warning, and the owner does not conflict with itself", [
        same("a draft warns", draft, [`warning webhookPathTaken POST /webhooks/o/fixed already answers for the procedure "${owner}"`]),
        same("the owner's own graph raises nothing", own, []),
      ]);

      const rivalName = ctx.unique("Rival");
      const rival = await createProcedure(ctx, { name: rivalName, graph: webhookGraph("/webhooks/o/fixed") });
      const imported = await auto(ctx, "read the rival", "GET", `/procedures/${rival}`);
      const moved = text(list(imported.body, "graph", "nodes")[0], "config", "path");
      const saved = await saveGraph(ctx, rival, webhookGraph("/webhooks/o/fixed"));
      const refused = await auto(ctx, "enable the rival", "PUT", `/procedures/${rival}/enabled`, { body: { enabled: true } });
      const stillDraft = await auto(ctx, "read the rival again", "GET", `/procedures/${rival}`);
      await ctx.verify("a rival on the same route is created as a draft and refused when enabled", [
        same("the rival is a draft", pick(imported.body, "enabled"), false),
        same("Import JSON moved the imported webhook to a free path", moved, "/webhooks/o/fixed-2"),
        statusIs(saved, 200, "saving the draft on the owner's route is accepted"),
        statusIs(refused, 400, "enabling answers 400"),
        same("the refusal message", text(refused.body, "message"), "$dms_automation.api.webhookPathTaken"),
        same("the refusal names the owner", issueLines(list(refused.body, "issues")), [taken("/webhooks/o/fixed")]),
        same("the rival stays disabled", pick(stillDraft.body, "enabled"), false),
      ]);

      const pause = await auto(ctx, "pause the owner", "PUT", `/procedures/${ownerId}/enabled`, { body: { enabled: false } });
      const freed = await auto(ctx, "enable the rival while the owner is paused", "PUT", `/procedures/${rival}/enabled`, { body: { enabled: true } });
      const resume = await auto(ctx, "resume the owner", "PUT", `/procedures/${ownerId}/enabled`, { body: { enabled: true } });
      await ctx.verify("a paused procedure frees its path, and resuming it is then refused naming the rival", [
        statusIs(pause, 200, "pausing answers 200"),
        statusIs(freed, 200, "the rival can be enabled"),
        statusIs(resume, 400, "resuming the owner answers 400"),
        same("the refusal names the rival", issueLines(list(resume.body, "issues")), [`error webhookPathTaken POST /webhooks/o/fixed already answers for the procedure "${rivalName}"`]),
      ]);

      const copy = await auto(ctx, "duplicate the rival", "POST", `/procedures/${rival}/duplicate`);
      const copyRead = await auto(ctx, "read the copy", "GET", `/procedures/${text(copy.body, "_id")}`);
      const second = await auto(ctx, "duplicate the rival again", "POST", `/procedures/${rival}/duplicate`);
      const secondRead = await auto(ctx, "read the second copy", "GET", `/procedures/${text(second.body, "_id")}`);
      const pathOf = (/** @type {import("../auto.mjs").Answer} */ answer) => text(list(answer.body, "graph", "nodes")[0], "config", "path");
      await ctx.verify("a duplicate moves its webhook to a free path", [
        same("the copy is named after the original", text(copyRead.body, "name"), `${rivalName} (copy)`),
        same("the copy is disabled", pick(copyRead.body, "enabled"), false),
        same("the copy's webhook path", pathOf(copyRead), "/webhooks/o/fixed-2"),
        same("a second copy takes the next free path", pathOf(secondRead), "/webhooks/o/fixed-3"),
      ]);

      const twin = issueLines(await issuesOf(ctx, graph([trigger("a", "webhook", { path: "/w/twin" }), trigger("b", "webhook", { path: "/w/twin", method: "POST" }), action("log", "log.message", { message: "x" })], [tedge("a", "log")]), { enabled: false }));
      await ctx.verify("two webhooks of one procedure on one route", [same("the second is refused", twin.filter((line) => line.includes("webhookPathDuplicate")), ["error webhookPathDuplicate two webhooks of this procedure answer POST /w/twin"])]);
    },
  },
  {
    id: "a-webhook-on-a-route-the-server-already-serves-is-refused",
    title: "a webhook is refused when a route the server already serves answers the same method on the same path, with a :param segment standing for any segment",
    entryPoint: "POST /procedures/validate, PUT /procedures/:id/enabled",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {[string, string | undefined, string[]][]} */
      const server = [
        ["/verify-auto/emit", undefined, ["error webhookRouteTaken POST /verify-auto/emit already answers for another route of the server"]],
        ["/verify-auto/:anything", undefined, ["error webhookRouteTaken POST /verify-auto/:anything already answers for another route of the server"]],
        ["/verify-auto/tick/abc", undefined, ["error webhookRouteTaken POST /verify-auto/tick/abc already answers for another route of the server"]],
        ["/verify-auto/ledger", "GET", ["error webhookRouteTaken GET /verify-auto/ledger already answers for another route of the server"]],
        ["/verify-auto/:x", "GET", ["error webhookRouteTaken GET /verify-auto/:x already answers for another route of the server"]],
        ["/verify-auto/ledger", "DELETE", ["error webhookRouteTaken DELETE /verify-auto/ledger already answers for another route of the server"]],
        ["/verify-auto/ledger", "POST", []],
        ["/verify-auto/ledger", "PATCH", []],
        ["/verify-auto/emit", "GET", []],
        ["/verify-auto/emit/extra", undefined, []],
        ["/verify-auto/tick/a/b", undefined, []],
        ["/verify-auto", undefined, []],
        ["/verify-autos/emit", undefined, []],
      ];
      /** @type {[string, string | undefined, string[], string[]][]} */
      const results = [];
      for (const [path, method, expected] of server) results.push([path, method, expected, issueLines(await issuesOf(ctx, webhookGraph(path, method), { enabled: true }))]);
      await ctx.verify("a route the server already serves answers the same method on the same path", results.map(([path, method, expected, lines]) => same(`${method ?? "POST"} ${path}`, lines, expected)));
      const id = await createProcedure(ctx, { name: ctx.unique("Shadow"), graph: webhookGraph("/verify-auto/emit") });
      const refused = await auto(ctx, "enable a webhook on a served route", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      await ctx.verify("enabling it is refused", [
        statusIs(refused, 400, "enabling answers 400"),
        same("the refusal message", text(refused.body, "message"), "$dms_automation.api.graphHasErrors"),
        same("the refusal lists the route", issueLines(list(refused.body, "issues")), ["error webhookRouteTaken POST /verify-auto/emit already answers for another route of the server"]),
      ]);
    },
  },
  ...overlapJourneys,
  ...callJourneys,
  ...pageJourneys,
]);
