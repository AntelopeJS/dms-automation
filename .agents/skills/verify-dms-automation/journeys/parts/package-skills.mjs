import { auto, check, list, parseJson, pick, same, text } from "../../auto.mjs";
import { createProcedure, runOf } from "../../procs.mjs";
import { actionNode, chainGraph, stepOf, triggerNode, valueOf } from "./interface-calls.mjs";
import { INTERFACE, MODULE, read, readJson, splitFrontMatter } from "./package-files.mjs";
import { caseChecks, configKeyChecks, declaredRoutes, frontMatterChecks, routeChecks } from "./package-skill-checks.mjs";
import { SKILL_PACKAGES, obj } from "./package-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */

export const skillJourneys = [
  {
    id: "the-shipped-skills-have-valid-front-matter-and-cases",
    title: "each shipped skill has a front matter with its folder name, a description that says when to use it, an icon, a category and tags, and cases whose expectations name shipped skills and phrases the skill contains",
    entryPoint: "skills/*/SKILL.md and skills/*/cases.json of both packages",
    async run(/** @type {Ctx} */ ctx) {
      const known = SKILL_PACKAGES.map((entry) => entry.skill);
      const skillTexts = Object.fromEntries(SKILL_PACKAGES.map((entry) => [entry.skill, read(ctx, `${entry.folder}/skills/${entry.skill}/SKILL.md`)]));
      /** @type {Set<string>} */
      const caseIds = new Set();
      for (const { folder, skill } of SKILL_PACKAGES) {
        const ownIface = read(ctx, `${INTERFACE}/dist/index.d.ts`);
        await ctx.verify(`${skill} front matter`, frontMatterChecks(skill, splitFrontMatter(skillTexts[skill]), skillTexts[skill], ownIface));
        const cases = obj(readJson(ctx, `${folder}/skills/${skill}/cases.json`));
        const caseList = list(cases, "cases");
        /** @type {Check[]} */
        const checks = [same("version 1", cases.version, 1), check("there are cases", caseList.length > 0, caseList.length)];
        for (const entry of caseList) {
          checks.push(...caseChecks(entry, known, skillTexts, caseIds));
          caseIds.add(String(entry.id));
        }
        await ctx.verify(`${skill} cases`, checks);
      }
    },
  },
  {
    id: "the-module-skill-statements-name-things-that-exist",
    title: "the module skill's config keys and defaults, API routes, page paths and webhook prefixes are the ones the docs and the source have",
    entryPoint: "skills/dms-automation/SKILL.md against docs/3.configuration.md, src/index.ts, src/routes, src/pages, webhook.ts",
    async run(/** @type {Ctx} */ ctx) {
      const skill = read(ctx, `${MODULE}/skills/dms-automation/SKILL.md`);
      const config = read(ctx, `${MODULE}/docs/3.configuration.md`);
      const source = read(ctx, `${MODULE}/src/index.ts`);
      await ctx.verify("config keys", configKeyChecks(skill, config, source));
      await ctx.verify("API routes", routeChecks(skill, declaredRoutes(ctx)));
      const shared = read(ctx, `${MODULE}/src/pages/shared.ts`);
      await ctx.verify("pages", [
        same("the module URL", /MODULE_URL = "([^"]+)"/.exec(shared)?.[1], "/modules/automation"),
        same("the builder and trace paths the skill gives", [/BUILDER_URL = `\$\{MODULE_URL\}(\/\w+)`/.exec(shared)?.[1], /TRACE_URL = `\$\{MODULE_URL\}(\/\w+)`/.exec(shared)?.[1]], ["/builder", "/trace"]),
        check("the skill states them", skill.includes("/modules/automation/builder?selected=<id>") && skill.includes("/modules/automation/trace?run=<id>"), skill.length),
      ]);
      const webhook = read(ctx, `${MODULE}/src/runtime/builtins/triggers/webhook.ts`);
      const reserved = parseJson(/RESERVED_PREFIXES = (\[[^\]]*\])/.exec(webhook)?.[1] ?? "[]");
      const stated = [...(/Webhook paths cannot overlap an existing route or start with ([^;.]+)/.exec(skill)?.[1] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      const documented = [...(/The path is ([^\n]+?), or starts with/.exec(config)?.[1] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      await ctx.verify("reserved webhook prefixes", [same("the skill's list is the code's", stated, reserved), same("the docs' list is the code's", documented, reserved)]);
      const states = ["failing", "degraded", "healthy", "paused", "draft"];
      await ctx.verify("states", [
        same(
          "the skill's states in order",
          /States: ([^.]+)\./
            .exec(skill)?.[1]
            ?.replace(/ \([^)]*\)/g, "")
            .split(", "),
          states,
        ),
      ]);
    },
  },
  {
    id: "the-module-skill-api-walk-works-as-written",
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
];
