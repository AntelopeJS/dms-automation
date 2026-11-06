import { guarded } from "../guard.mjs";
import { auto, check, list, pick, raw, same, text } from "../auto.mjs";
import { createProcedure, manualLog } from "../procs.mjs";
import { member } from "./parts/access-members.mjs";
import { innerOf } from "./parts/procedures-page-ui.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

/** Every route the module serves under /api/automation: method, path with `:id` for an existing procedure, and whether the call needs a JSON body. */
const ROUTES = [
  ["GET", "/procedures"], ["GET", "/procedures/summary"], ["POST", "/procedures/validate"], ["POST", "/procedures/new"], ["POST", "/procedures/import"],
  ["GET", "/procedures/:id"], ["GET", "/procedures/:id/export"], ["POST", "/procedures/:id/duplicate"], ["PUT", "/procedures/:id"], ["PUT", "/procedures/:id/enabled"],
  ["POST", "/procedures/:id/dismiss-attention"], ["DELETE", "/procedures/:id/dismiss-attention"], ["DELETE", "/procedures/:id"], ["GET", "/procedures/:id/delete-confirm"],
  ["POST", "/procedures/:id/run-now"], ["POST", "/procedures/:id/test"], ["POST", "/procedures/:id/test-effects"], ["GET", "/procedures/:id/last-payload"],
  ["GET", "/procedures/:id/triggers"], ["GET", "/procedures/:id/runs"],
  ["GET", "/trigger-types"], ["PUT", "/trigger-types/manual/config"], ["GET", "/action-types"], ["PUT", "/action-types/log.message/config"], ["GET", "/data-node-types"], ["GET", "/node-kinds"],
  ["GET", "/templates"], ["GET", "/templates/x"], ["POST", "/templates"], ["PUT", "/templates/x"], ["DELETE", "/templates/x"], ["GET", "/templates/x/usages"],
  ["GET", "/stats/health"], ["GET", "/stats/kpi/runs"], ["GET", "/stats/runs-per-day"], ["GET", "/stats/attention"], ["GET", "/stats/recent-runs"], ["GET", "/stats/procedures"], ["GET", "/stats/triggers"],
  ["GET", "/library/counts"], ["GET", "/library/webhook-base"], ["GET", "/library/usage/triggers"],
  ["GET", "/runs/kpi/runs"], ["GET", "/runs/scope/banner"], ["GET", "/runs/x"], ["GET", "/runs/x/logs"], ["GET", "/runs/x/rerun-confirm"], ["POST", "/runs/x/rerun"],
  ["GET", "/tables/procedures/list"], ["GET", "/tables/procedures/count"], ["GET", "/tables/procedures/select"], ["GET", "/tables/procedures/count/batch"],
  ["GET", "/tables/runs/list"], ["GET", "/tables/runs/count"],
];

/** The text of the refusal: the run table's routes name the permission they check, every other route says Owner-only. */
const refusalOf = (/** @type {string} */ route) => (route.includes("/tables/runs/") ? "Forbidden: missing permission modules.automation.runs.table.list" : "Owner-only");

/** @param {Ctx} ctx @param {string} method @param {string} path @param {string | undefined} who */
async function call(ctx, method, path, who) {
  const body = method === "GET" || method === "DELETE" ? undefined : "{}";
  const answer = await raw(ctx, `${method} ${path} as ${who ?? "nobody"}`, { path: `/api/automation${path}`, method, as: who, headers: body ? { "content-type": "application/json" } : {}, body });
  return answer;
}

/** @param {Ctx} ctx @param {string} id @param {string | undefined} who */
async function sweep(ctx, id, who) {
  const results = [];
  for (const [method, template] of ROUTES) {
    if (who === "admin" && (method === "DELETE" && template === "/procedures/:id")) continue;
    const path = template.replace(":id", id);
    const answer = await call(ctx, method, path, who);
    results.push({ route: `${method} ${template}`, status: answer.status, message: answer.text.slice(0, 80) });
  }
  return results;
}

export const journeys = guarded([
  {
    id: "every-automation-route-answers-401-without-a-session",
    title: "the module's API answers 401 to a caller with no session, on every route and method, and a refused delete or pause changes nothing",
    entryPoint: "every /api/automation route as nobody",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: "Guarded", graph: manualLog("x") });
      await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const results = await sweep(ctx, id, undefined);
      const after = await auto(ctx, "read it as the owner", "GET", `/procedures/${id}`);
      const bogus = await call(ctx, "GET", "/procedures/summary", "anon");
      await ctx.verify("nobody", [
        ...results.map((r) => same(`${r.route} is 401 "No jwt token provided"`, [r.status, r.message], [401, "No jwt token provided"])),
        same("the procedure is untouched: still enabled, graph kept", [text(after.body, "name"), pick(after.body, "enabled"), list(after.body, "graph", "nodes").length], ["Guarded", true, 2]),
        same("an unknown session token is no better", bogus.status === 401 || bogus.status === 404, true),
      ]);
      const forged = await raw(ctx, "a forged bearer token", { path: "/api/automation/procedures", headers: { authorization: "Bearer not-a-token" } });
      await ctx.verify("a made-up token", [same("is refused 401", forged.status, 401)]);
    },
  },
  {
    id: "a-member-without-permissions-gets-403-owner-only-on-every-route",
    title: "the module's API answers the platform owner only: a signed-in member, even one whose role holds Automation page permissions, gets 403 Owner-only on every route and method, and nothing changes",
    entryPoint: "every /api/automation route as a member",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: "Guarded é", description: "kept", graph: manualLog("x") });
      await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      await member(ctx, "plain", []);
      await member(ctx, "pages", ["modules.automation", "modules.automation.procedures", "modules.automation.builder", "page:procedures", "page:builder", "page:runs", "page:library", "page:overview"]);
      const plain = await sweep(ctx, id, "plain");
      const pages = await sweep(ctx, id, "pages");
      const owner = await sweep(ctx, id, "admin");
      const after = await auto(ctx, "read it as the owner", "GET", `/procedures/${id}`);
      const exported = await auto(ctx, "export as the owner", "GET", `/procedures/${id}/export`);
      const wrongMethods = [];
      for (const [method, path] of [["PATCH", `/procedures/${id}`], ["DELETE", "/procedures"], ["POST", "/procedures/summary"], ["PUT", "/procedures"], ["POST", `/procedures/${id}/export`]]) wrongMethods.push({ method, path, answer: await call(ctx, method, path, "plain") });
      await ctx.verify("a member", [
        ...plain.map((r) => same(`${r.route}: 403 for a member with no permissions`, [r.status, r.message], [403, refusalOf(r.route)])),
        ...pages.map((r) => same(`${r.route}: 403 despite page permissions`, [r.status, r.message], [403, refusalOf(r.route)])),
        ...owner.map((r) => check(`${r.route}: the owner passes the guard (not 401 or 403)`, r.status !== 401 && r.status !== 403, [r.status, r.message])),
        same("nothing changed: name, description, enabled and graph", [text(after.body, "name"), text(after.body, "description"), pick(after.body, "enabled"), list(exported.body, "graph", "nodes").length], ["Guarded é", "kept", true, 2]),
        ...wrongMethods.map((w) => check(`${w.method} ${w.path.replace(id, ":id")} is not a route: 404 even for a member`, w.answer.status === 404, [w.answer.status, w.answer.text.slice(0, 40)])),
      ]);
    },
  },
  {
    id: "a-member-cannot-open-the-automation-pages",
    title: "the Automation pages are the platform owner's: a member is sent to Settings from every page of the module, and the module list answers 403 Forbidden, while the owner opens them",
    entryPoint: "/modules/automation/{overview,procedures,builder,runs,trace,library} as a member and as the owner",
    async run(/** @type {Ctx} */ ctx) {
      await member(ctx, "plain", []);
      await member(ctx, "pages", ["modules.automation", "modules.automation.procedures", "page:procedures", "page:overview"]);
      const paths = ["/modules/automation/overview", "/modules/automation/procedures", "/modules/automation/builder", "/modules/automation/runs", "/modules/automation/trace", "/modules/automation/library"];
      const seen = [];
      for (const who of ["plain", "pages"]) {
        const tab = await ctx.tab(who);
        await tab.signIn(who);
        for (const path of paths) {
          await tab.goto(path);
          await tab.page.waitForLoadState("load");
          await tab.page.waitForTimeout(1500);
          const body = (await innerOf(tab, "body")).replace(/\s+/g, " ");
          seen.push({ who, path, at: new URL(tab.page.url()).pathname, heading: await tab.page.getByRole("heading", { name: /^(Procedures|Overview|Run history|Library|Builder)$/, level: 1 }).count(), yourProfile: /Your profile, security and preferences/.test(body) });
        }
        await tab.goto("/modules");
        const forbidden = await tab.shows(/403\s+Forbidden/, { timeoutMs: 15_000 });
        seen.push({ who, path: "/modules", at: new URL(tab.page.url()).pathname, forbidden: forbidden.pass });
      }
      const owner = await ctx.tab("admin");
      await owner.signIn("admin");
      const ownerSeen = [];
      for (const path of paths.slice(0, 2)) {
        await owner.goto(path);
        ownerSeen.push(await owner.shows(path.endsWith("overview") ? /Overview/ : /Every procedure, what starts it/));
      }
      await ctx.verify("pages", [
        ...seen.filter((s) => s.path !== "/modules").map((s) => same(`${s.path} for ${s.who} lands on /settings with no Automation heading`, [s.at, s.heading, s.yourProfile], ["/settings", 0, true])),
        ...seen.filter((s) => s.path === "/modules").map((s) => same(`/modules for ${s.who} answers 403 Forbidden`, [s.at, s.forbidden], ["/modules", true])),
        ...ownerSeen,
      ]);
    },
  },
]);
