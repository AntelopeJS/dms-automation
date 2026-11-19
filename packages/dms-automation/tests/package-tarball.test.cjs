const nodePath = require("node:path");
const { test } = require("node:test");
const { check, isText, same, assertChecks } = require("./helpers/checks.cjs");
const {
  INTERFACE,
  MODULE,
  ROOT,
  byText,
  exportTargets,
  filesBelow,
  manifestOf,
  packedFiles,
  strings,
} = require("./helpers/package-files.cjs");

for (const folder of [MODULE, INTERFACE]) {
  const manifest = manifestOf(folder);

  void test(`${String(manifest.name)} tarball: fails on a files list that ships a source or drops dist, skills or an entry point`, async (t) => {
    const packed = packedFiles(folder);
    const files = new Set(packed.files);
    const allowedRoots = strings(manifest.files).filter(
      (entry) => !entry.startsWith("!"),
    );
    const outsiders = packed.files.filter(
      (file) =>
        !allowedRoots.some(
          (root) => file === root || file.startsWith(`${root}/`),
        ) && !["README.md", "LICENSE", "package.json"].includes(file),
    );
    const dist = filesBelow(nodePath.join(ROOT, folder, "dist"), (path) =>
      path.endsWith(".tsbuildinfo"),
    ).map((file) => `dist/${file}`);
    const skills = filesBelow(nodePath.join(ROOT, folder, "skills")).map(
      (file) => `skills/${file}`,
    );
    const forbidden = packed.files.filter(
      (file) =>
        /^(src|tests|playground|scripts|node_modules)\//.test(file) ||
        /^(CHANGELOG\.md|knip\.config\.ts|tsconfig\.json|pnpm-lock\.yaml|\.release-it\.json|changelogen\.config\.json)$/.test(
          file,
        ) ||
        file.endsWith(".tsbuildinfo"),
    );
    const entryPoints = [
      manifest.main,
      manifest.types,
      manifest.dmsFrontend,
      ...exportTargets(manifest),
    ].filter(isText);
    const extra =
      folder === MODULE
        ? [
            "frontend-vue/package.json",
            "frontend-vue/dms.frontend.ts",
            "frontend-vue/i18n/locales/dms-automation-en-GB.json",
            "frontend-vue/i18n/locales/dms-automation-fr-FR.json",
          ]
        : ["docs/1.index.md", "docs/tsconfig.json"];
    const appFiles =
      folder === MODULE
        ? filesBelow(
            nodePath.join(ROOT, folder, "frontend-vue", "app"),
            (path) => path.split("/").includes("node_modules"),
          ).map((file) => `frontend-vue/app/${file}`)
        : [];
    await assertChecks(t, `${String(manifest.name)} tarball`, [
      check(
        "npm pack produced a tarball description",
        packed.error === "",
        packed.error,
      ),
      same(
        "name and version are package.json's",
        [packed.name, packed.version],
        [manifest.name, manifest.version],
      ),
      same(
        "README, LICENSE and package.json are in",
        ["README.md", "LICENSE", "package.json"].filter(
          (file) => !files.has(file),
        ),
        [],
      ),
      same(
        "every built file of dist is in",
        dist.filter((file) => !files.has(file)),
        [],
      ),
      check(
        "dist has index.js and index.d.ts",
        files.has("dist/index.js") && files.has("dist/index.d.ts"),
        packed.files.filter((file) => file.startsWith("dist/")).length,
      ),
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
      same(
        "no source, test, playground, script, lockfile or changelog is in",
        forbidden,
        [],
      ),
      same(
        "exactly the declared folders",
        [
          ...new Set(
            packed.files
              .filter((file) => file.includes("/"))
              .map((file) => file.split("/")[0]),
          ),
        ].sort(byText),
        (folder === MODULE
          ? ["dist", "frontend-vue", "skills"]
          : ["dist", "docs", "skills"]
        ).sort(byText),
      ),
    ]);
  });
}
