import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { createProcedure, runNow, runOf } from "../../procs.mjs";
import { actionNode, chainGraph, logGraph, stepOf, triggerNode, valueOf } from "./interface-calls.mjs";
import { MODULE, read } from "./package-files.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */

export const runJourneys = [
  {
    id: "the-module-skill-api-walk-works-as-written",
    integration: true,
    title: "an exported procedure re-created with POST /procedures/import { json } is a disabled draft, PUT /:id/enabled { enabled } enables it, POST /:id/run-now { payload } runs it, and POST /:id/test answers 409 with realEffects until confirmRealEffects is true",
    entryPoint: "POST /procedures/import, PUT /procedures/:id/enabled, POST /procedures/:id/run-now, POST /procedures/:id/test, POST /procedures/:id/test-effects",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Skill walk é");
      const exported = {
        name,
        description: "from a builder export 日本",
        graph: chainGraph([
          triggerNode("t"),
          actionNode("log", "log.message", { message: "walk" }),
          actionNode("req", "http.request", {
            url: "http://127.0.0.1:9/never",
            method: "GET",
          }),
        ]),
      };
      const imported = await auto(ctx, "import", "POST", "/procedures/import", {
        body: { json: JSON.stringify(exported) },
      });
      const id = text(imported.body, "_id");
      const draft = await auto(ctx, "read", "GET", `/procedures/${id}`);
      await ctx.verify("import", [same("status", imported.status, 200), same("a disabled draft with the exported fields", [pick(draft.body, "name"), pick(draft.body, "description"), pick(draft.body, "enabled")], [name, "from a builder export 日本", false])]);
      const enabled = await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const after = await auto(ctx, "read", "GET", `/procedures/${id}`);
      await ctx.verify("enable", [same("status", enabled.status, 200), same("enabled", pick(after.body, "enabled"), true)]);
      const effects = await auto(ctx, "test-effects", "POST", `/procedures/${id}/test-effects`, { body: { graph: exported.graph } });
      const refused = await auto(ctx, "test without confirmation", "POST", `/procedures/${id}/test`, { body: { graph: exported.graph } });
      await ctx.verify("test runs", [
        same(
          "test-effects lists the HTTP request",
          list(effects.body, "realEffects").map((step) => [step.nodeId, step.typeId]),
          [["req", "http.request"]],
        ),
        same("test answers 409 with realEffects", [refused.status, list(refused.body, "realEffects").map((step) => step.nodeId)], [409, ["req"]]),
      ]);
      const logOnly = chainGraph([triggerNode("t"), actionNode("log", "log.message", { message: "payload test" })]);
      const secondId = await createProcedure(ctx, { graph: logOnly });
      const ran = await auto(ctx, "run-now with a payload", "POST", `/procedures/${secondId}/run-now`, { body: { payload: { orderId: "10477", note: "é 日本" } } });
      const run = await runOf(ctx, text(ran.body, "runId"));
      await ctx.verify("run-now", [
        same("status and outcome", [ran.status, pick(ran.body, "status")], [200, "ok"]),
        same("the payload the trigger received", valueOf(stepOf(run, "t").output), { orderId: "10477", note: "é 日本" }),
        same("the stored payload", run.triggerPayload, JSON.stringify({ orderId: "10477", note: "é 日本" })),
      ]);
    },
  },
  {
    id: "the-module-skill-webhook-prefixes-are-refused",
    integration: true,
    title: "a webhook path that is /api, /auth, /dms, /modules or /settings, or starts with one of them and a slash, is refused; a path that merely begins with the same letters is not",
    entryPoint: "POST /procedures/validate with a webhook trigger",
    async run(/** @type {Ctx} */ ctx) {
      const skill = read(ctx, `${MODULE}/skills/dms-automation/SKILL.md`);
      const prefixes = [...(/start with ([^;.]+)/.exec(skill)?.[1] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      /** @param {string} path */
      const validate = async (path) => {
        const graph = chainGraph([triggerNode("w", "webhook", { path, method: "POST" }), actionNode("l", "log.message", { message: "x" })]);
        const answer = await auto(ctx, `validate ${path}`, "POST", "/procedures/validate", { body: { graph, enabled: true } });
        return list(answer.body, "issues").filter((issue) => issue.severity === "error");
      };
      /** @type {Check[]} */
      const checks = [same("the skill lists five prefixes", prefixes, ["/api", "/auth", "/dms", "/modules", "/settings"])];
      for (const prefix of prefixes) {
        checks.push(check(`${prefix} is refused`, (await validate(prefix)).length > 0, prefix));
        checks.push(check(`${prefix}/x is refused`, (await validate(`${prefix}/x`)).length > 0, prefix));
        checks.push(
          same(
            `${prefix}x is allowed`,
            (await validate(`${prefix}x/y`)).map((issue) => issue.code),
            [],
          ),
        );
      }
      checks.push(
        same(
          "an ordinary path is allowed",
          (await validate("/verify-skill/hook")).map((issue) => issue.code),
          [],
        ),
      );
      await ctx.verify("reserved prefixes", checks);
    },
  },
  {
    id: "the-module-skill-pages-open-for-the-owner",
    title: "the pages the skill names open for the platform owner: Overview, Run history, Procedures, Builder, Library, and Run trace with ?run=",
    entryPoint: "/modules/automation/overview, /runs, /procedures, /builder?selected=<id>, /library, /trace?run=<id>",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, {
        name: ctx.unique("Pages é"),
        graph: logGraph("pages"),
      });
      const ran = await runNow(ctx, id);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      const pages = [
        {
          path: "/modules/automation/overview",
          shows: /How automation is doing/,
        },
        { path: "/modules/automation/runs", shows: /Run history/ },
        { path: "/modules/automation/procedures", shows: /New procedure/ },
        {
          path: `/modules/automation/builder?selected=${id}`,
          shows: /Pages é|Log/,
        },
        {
          path: "/modules/automation/library",
          shows: /Every building block in one place/,
        },
        {
          path: `/modules/automation/trace?run=${ran.runId}`,
          shows: /Pages é|pages/,
        },
      ];
      for (const page of pages) {
        await tab.goto(page.path);
        await ctx.verify(page.path.split("?")[0], [await tab.shows(page.shows), await tab.at(new RegExp(`^${page.path.split("?")[0]}`))]);
      }
    },
  },
];
