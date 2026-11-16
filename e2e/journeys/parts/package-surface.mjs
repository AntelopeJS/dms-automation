import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { auto, check, list, same } from "../../auto.mjs";
import { createProcedure, runNow } from "../../procs.mjs";
import { actionNode, chainGraph, logGraph, triggerNode } from "./interface-calls.mjs";
import { INTERFACE, MODULE, codeBlocks, read, repoOf } from "./package-files.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */
/** @typedef {Record<string, unknown>} Json */

export const surfaceJourneys = [
  {
    id: "the-module-skill-webhook-prefixes-are-refused",
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
  {
    id: "the-interface-skill-and-docs-name-what-the-interface-exports",
    title: "every import the interface skill lists is exported by the built interface, the skill says there is one entry point, and the docs' code blocks type-check against the interface",
    entryPoint: "skills/dms-automation-interface/SKILL.md, docs/1.index.md, docs/5.extending.md, READMEs against dist/index.d.ts",
    async run(/** @type {Ctx} */ ctx) {
      const skill = read(ctx, `${INTERFACE}/skills/dms-automation-interface/SKILL.md`);
      const declarations = read(ctx, `${INTERFACE}/dist/index.d.ts`);
      const imports = (/import \{([\s\S]*?)\} from "@antelopejs\/interface-dms-automation"/.exec(skill)?.[1] ?? "")
        .split(",")
        .map((entry) => entry.replace(/type /, "").trim())
        .filter(Boolean);
      const exported = new Set([...declarations.matchAll(/export (?:declare )?(?:const|function|interface|type|class) (\w+)/g)].map((match) => match[1]));
      await ctx.verify("the skill's import list", [
        check("it lists the functions and types", imports.length >= 24, imports.length),
        same(
          "each one is exported",
          imports.filter((name) => !exported.has(name)),
          [],
        ),
        same(
          "every exported function is listed",
          [...declarations.matchAll(/export (?:declare )?(?:const|function) (\w+)/g)].map((match) => match[1]).filter((name) => /^(Register|Unregister|List|Invoke|Run|Declare)/.test(name) && !imports.includes(name)),
          [],
        ),
      ]);
      const resolved = spawnSync(process.execPath, ["-e", 'try { require.resolve("@antelopejs/interface-dms-automation/does-not-exist"); console.log("resolved"); } catch (e) { console.log(e.code); }'], { cwd: join(repoOf(ctx), MODULE), encoding: "utf8" });
      await ctx.verify("single entry point", [
        check("the skill says so", /Single entry point only/.test(skill), skill.length),
        same("another subpath does not resolve", resolved.stdout.trim(), "MODULE_NOT_FOUND"),
        check("the docs say the internal namespace is not a consumer entry point", /The `internal` proxy namespace is not a supported consumer entry point/.test(read(ctx, `${INTERFACE}/docs/1.index.md`)), 0),
      ]);
      const folder = ctx.step("docs code blocks");
      mkdirSync(folder, { recursive: true });
      /** @type {string[]} */
      const names = [];
      const sources = [`${MODULE}/docs/5.extending.md`, `${INTERFACE}/docs/1.index.md`, `${INTERFACE}/README.md`, `${MODULE}/README.md`];
      for (const source of sources) {
        let index = 0;
        for (const block of codeBlocks(read(ctx, source))) {
          index += 1;
          if (!["ts", "typescript"].includes(block.language) || /fragment/.test(block.info)) continue;
          const file = `${source.replace(/[^\w]+/g, "_")}_${index}.ts`;
          writeFileSync(join(folder, file), /^(import|export) /m.test(block.body) ? block.body : `${block.body}\nexport {};\n`);
          names.push(file);
        }
      }
      writeFileSync(
        join(folder, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: "esnext",
            moduleResolution: "bundler",
            target: "es2022",
            skipLibCheck: true,
            typeRoots: [join(repoOf(ctx), INTERFACE, "node_modules", "@types")],
            types: ["node"],
            paths: {
              "@antelopejs/interface-dms-automation": [join(repoOf(ctx), INTERFACE, "dist", "index.d.ts")],
            },
          },
          include: ["*.ts"],
        }),
      );
      const compiled = spawnSync(join(repoOf(ctx), MODULE, "node_modules", ".bin", "tsc"), ["-p", join(folder, "tsconfig.json")], { encoding: "utf8" });
      const errors = compiled.stdout.split("\n").filter((line) => /error TS/.test(line));
      await ctx.verify("the docs' TypeScript blocks compile", [check("there are blocks to compile", names.length >= 14, names.length), same("no type error", errors, [])]);
    },
  },
];
