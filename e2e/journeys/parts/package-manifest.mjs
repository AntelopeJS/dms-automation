import { join } from "node:path";
import { check, isText, same } from "../../auto.mjs";
import { INTERFACE, MODULE, compatRows, exists, filesBelow, normalRange, packedFiles, parts, read, readJson, repoOf } from "./package-files.mjs";
import { byText, exportTargets, manifestOf, obj, strings } from "./package-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */
/** @typedef {Record<string, unknown>} Json */

export const manifestJourneys = [
  {
    id: "npm-pack-holds-what-package-json-files-lists-for-both-packages",
    title: "the tarball of each package holds its dist, skills, docs or frontend-vue, README, LICENSE and package.json, every entry point it declares, and none of the sources, tests, playground or scripts",
    entryPoint: "npm pack --dry-run in packages/dms-automation and packages/interface-dms-automation",
    async run(/** @type {Ctx} */ ctx) {
      for (const folder of [MODULE, INTERFACE]) {
        const manifest = manifestOf(ctx, folder);
        const packed = packedFiles(ctx, folder);
        const files = new Set(packed.files);
        const allowedRoots = strings(manifest.files).filter((entry) => !entry.startsWith("!"));
        const outsiders = packed.files.filter((file) => !allowedRoots.some((root) => file === root || file.startsWith(`${root}/`)) && !["README.md", "LICENSE", "package.json"].includes(file));
        const dist = filesBelow(join(repoOf(ctx), folder, "dist"), (path) => path.endsWith(".tsbuildinfo")).map((file) => `dist/${file}`);
        const skills = filesBelow(join(repoOf(ctx), folder, "skills")).map((file) => `skills/${file}`);
        const forbidden = packed.files.filter((file) => /^(src|tests|playground|scripts|node_modules)\//.test(file) || /^(CHANGELOG\.md|knip\.config\.ts|tsconfig\.json|pnpm-lock\.yaml|\.release-it\.json|changelogen\.config\.json)$/.test(file) || file.endsWith(".tsbuildinfo"));
        const entryPoints = [manifest.main, manifest.types, manifest.dmsFrontend, ...exportTargets(manifest)].filter(isText);
        const extra = folder === MODULE ? ["frontend-vue/package.json", "frontend-vue/dms.frontend.ts", "frontend-vue/i18n/locales/dms-automation-en-GB.json", "frontend-vue/i18n/locales/dms-automation-fr-FR.json"] : ["docs/1.index.md", "docs/tsconfig.json"];
        const appFiles = folder === MODULE ? filesBelow(join(repoOf(ctx), folder, "frontend-vue", "app"), (path) => path.split("/").includes("node_modules")).map((file) => `frontend-vue/app/${file}`) : [];
        await ctx.verify(`${String(manifest.name)} tarball`, [
          check("npm pack produced a tarball description", packed.error === "", packed.error),
          same("name and version are package.json's", [packed.name, packed.version], [manifest.name, manifest.version]),
          same(
            "README, LICENSE and package.json are in",
            ["README.md", "LICENSE", "package.json"].filter((file) => !files.has(file)),
            [],
          ),
          same(
            "every built file of dist is in",
            dist.filter((file) => !files.has(file)),
            [],
          ),
          check("dist has index.js and index.d.ts", files.has("dist/index.js") && files.has("dist/index.d.ts"), packed.files.filter((file) => file.startsWith("dist/")).length),
          same(
            "every shipped skill file is in",
            skills.filter((file) => !files.has(file)),
            [],
          ),
          same(
            "every entry point the manifest names is in",
            entryPoints.filter((entry) => !files.has(entry)),
            [],
          ),
          same(
            "the extra files of this package are in",
            extra.filter((file) => !files.has(file)),
            [],
          ),
          same(
            "every app file of the frontend is in",
            appFiles.filter((file) => !files.has(file)),
            [],
          ),
          same("nothing outside `files` is in", outsiders, []),
          same("no source, test, playground, script, lockfile or changelog is in", forbidden, []),
          same("exactly the declared folders", [...new Set(packed.files.filter((file) => file.includes("/")).map((file) => file.split("/")[0]))].sort(byText), (folder === MODULE ? ["dist", "frontend-vue", "skills"] : ["dist", "docs", "skills"]).sort(byText)),
        ]);
      }
    },
  },
  {
    id: "the-manifests-declare-skills-entry-points-and-ranges-that-agree",
    title: "package.json, the README compatibility tables, the docs and the interface agree on names, versions, ranges, skills, the frontend module and the renderer range",
    entryPoint: "package.json of both packages, README compatibility blocks, docs/2.installation.md, docs/5.extending.md",
    async run(/** @type {Ctx} */ ctx) {
      const module = manifestOf(ctx, MODULE);
      const iface = manifestOf(ctx, INTERFACE);
      const moduleDeps = {
        ...obj(module.devDependencies),
        ...obj(module.optionalDependencies),
        ...obj(module.dependencies),
      };
      const interfaceVersion = String(iface.version);
      const { major, minor } = parts(interfaceVersion);
      const narrow = major === 0 ? `>=${interfaceVersion} <0.${minor + 1}.0` : `>=${interfaceVersion} <${major + 1}.0.0`;
      await ctx.verify("names and the publish contract", [
        same("names", [module.name, iface.name], ["@antelopejs/dms-automation", "@antelopejs/interface-dms-automation"]),
        same("licences", [module.license, iface.license], ["Apache-2.0", "Apache-2.0"]),
        same(
          "both publish publicly with provenance",
          [obj(module.publishConfig), obj(iface.publishConfig)],
          [
            {
              access: "public",
              provenance: true,
              registry: "https://registry.npmjs.org/",
            },
            {
              access: "public",
              provenance: true,
              registry: "https://registry.npmjs.org/",
            },
          ],
        ),
        same("repository directories", [obj(module.repository).directory, obj(iface.repository).directory], [MODULE, INTERFACE]),
        same("homepages", [module.homepage, iface.homepage], ["https://dms.antelopejs.com/docs/modules/automation", "https://dms.antelopejs.com/docs/modules/automation/extending"]),
      ]);
      await ctx.verify("what each package declares to AntelopeJS", [
        same("the module implements the interface", obj(module.antelopeJs).implements, ["@antelopejs/interface-dms-automation"]),
        same("the module declares its skills folder", obj(module.antelopeJs).skills, ["./skills"]),
        same("the interface declares its skills folder", obj(iface.antelopeJs).skills, ["./skills"]),
        same("the module's baseUrl is dist", obj(module.antelopeJs).baseUrl, "dist"),
        same("the frontend module is the built one", [module.dmsFrontend, exists(ctx, `${MODULE}/dist/frontend-module.js`)], ["dist/frontend-module.js", true]),
        same("main and types", [module.main, module.types, iface.main, iface.types], ["dist/index.js", "dist/index.d.ts", "dist/index.js", "dist/index.d.ts"]),
        same("the skills folders exist with a skill each", [exists(ctx, `${MODULE}/skills/dms-automation/SKILL.md`), exists(ctx, `${INTERFACE}/skills/dms-automation-interface/SKILL.md`)], [true, true]),
      ]);
      const moduleRows = compatRows(read(ctx, `${MODULE}/README.md`));
      const interfaceRows = compatRows(read(ctx, `${INTERFACE}/README.md`));
      const interfaceRow = moduleRows.find((row) => row.name === "@antelopejs/interface-dms-automation");
      await ctx.verify("the module's range on the interface", [
        same("package.json depends on the interface from its version to the next minor", normalRange(String(moduleDeps["@antelopejs/interface-dms-automation"])), narrow),
        same("the README says the same, supported", normalRange(interfaceRow?.supported ?? ""), narrow),
        same("the README tested-with is the interface version", interfaceRow?.tested, interfaceVersion),
      ]);
      /** @type {Check[]} */
      const rowChecks = [];
      for (const row of moduleRows) {
        const declared = String(moduleDeps[row.name]);
        rowChecks.push(same(`module README row ${row.name}: supported is the declared range`, row.supported, declared));
      }
      const peer = obj(iface.peerDependencies);
      for (const row of interfaceRows) rowChecks.push(same(`interface README row ${row.name}: supported is the peer range`, row.supported, String(peer[row.name])));
      rowChecks.push(
        same(
          "every runtime interface dependency of the module has a row",
          Object.keys({
            ...obj(module.dependencies),
            ...obj(module.optionalDependencies),
          }).filter((name) => name.startsWith("@antelopejs/interface-") && !moduleRows.some((row) => row.name === name)),
          [],
        ),
        same(
          "the interface's only peer has a row",
          Object.keys(peer).filter((name) => !interfaceRows.some((row) => row.name === name)),
          [],
        ),
      );
      await ctx.verify("the README compatibility tables", rowChecks);
      const extending = read(ctx, `${MODULE}/docs/5.extending.md`);
      const installation = read(ctx, `${MODULE}/docs/2.installation.md`);
      const interfaceReadme = read(ctx, `${INTERFACE}/README.md`);
      const minorFloor = (/** @type {string} */ version) => `>=${parts(version).major}.${parts(version).minor}.0 <1.0.0`;
      await ctx.verify("ranges quoted in the docs", [
        same("the consumer range in Extending", /"@antelopejs\/interface-dms-automation": "([^"]+)"/.exec(extending)?.[1], minorFloor(interfaceVersion)),
        same("the module range in Installation", /version: "([^"]+)"/.exec(installation)?.[1], minorFloor(String(module.version))),
        check("the interface README says a wide range from the release up to <1.0.0", /up to `<1\.0\.0`/.test(interfaceReadme), interfaceReadme.slice(0, 0)),
        same("the interface README's peer row is its peer dependency", normalRange(interfaceRows[0]?.supported ?? ""), normalRange(String(peer["@antelopejs/interface-core"]))),
      ]);
      const frontend = readJson(ctx, `${MODULE}/frontend-vue/package.json`);
      const renderer = obj(frontend.engines)["@antelopejs/dms-frontend"];
      await ctx.verify("the renderer range", [
        check("the frontend module declares a renderer range", isText(renderer) && renderer.length > 0, renderer),
        same("it is the range the frontend builds against", renderer, obj(frontend.devDependencies)["@antelopejs/dms-frontend"]),
        same("the docs name that field", /engines\["@antelopejs\/dms-frontend"\]/.test(read(ctx, `${MODULE}/docs/1.introduction.md`)) && /engines\["@antelopejs\/dms-frontend"\]/.test(read(ctx, `${MODULE}/README.md`)), true),
      ]);
      /** @param {string} readme */
      const docsBadge = (readme) => /href="(https:\/\/dms\.antelopejs\.com\/[^"]+)"><img alt="Documentation"/.exec(readme)?.[1];
      await ctx.verify("the documentation badges", [same("module", docsBadge(read(ctx, `${MODULE}/README.md`)), module.homepage), same("interface", docsBadge(interfaceReadme), iface.homepage)]);
      const renamed = [
        ["database", read(ctx, `${MODULE}/src/types/constants.ts`).match(/DATABASE_NAME = "([^"]+)"/)?.[1], "dms-automation"],
        ["schema", read(ctx, `${MODULE}/src/types/constants.ts`).match(/SCHEMA_NAME = "([^"]+)"/)?.[1], "dms_automation"],
        [
          "i18n namespace files",
          filesBelow(join(repoOf(ctx), MODULE, "frontend-vue", "i18n", "locales"))
            .sort()
            .join(","),
          "dms-automation-en-GB.json,dms-automation-fr-FR.json",
        ],
      ];
      await ctx.verify(
        "the CMS-era names are gone, as the Installation note says",
        renamed.map(([what, actual, expected]) => same(`the ${what} is ${expected}`, actual, expected)),
      );
    },
  },
];
