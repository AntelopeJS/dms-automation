const nodePath = require("node:path");
const { test } = require("node:test");
const { check, isText, same, assertChecks } = require("./helpers/checks.cjs");
const {
  INTERFACE,
  MODULE,
  ROOT,
  compatRows,
  exists,
  filesBelow,
  manifestOf,
  normalRange,
  obj,
  parts,
  read,
  readJson,
} = require("./helpers/package-files.cjs");

const module_ = manifestOf(MODULE);
const iface = manifestOf(INTERFACE);
const moduleDeps = {
  ...obj(module_.devDependencies),
  ...obj(module_.optionalDependencies),
  ...obj(module_.dependencies),
};
const interfaceVersion = String(iface.version);

void test("names and the publish contract: fails on a renamed package, another licence, no provenance or a wrong homepage", async (t) => {
  await assertChecks(t, "names and the publish contract", [
    same(
      "names",
      [module_.name, iface.name],
      ["@antelopejs/dms-automation", "@antelopejs/interface-dms-automation"],
    ),
    same(
      "licences",
      [module_.license, iface.license],
      ["Apache-2.0", "Apache-2.0"],
    ),
    same(
      "both publish publicly with provenance",
      [obj(module_.publishConfig), obj(iface.publishConfig)],
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
    same(
      "repository directories",
      [obj(module_.repository).directory, obj(iface.repository).directory],
      [MODULE, INTERFACE],
    ),
    same(
      "homepages",
      [module_.homepage, iface.homepage],
      [
        "https://dms.antelopejs.com/docs/modules/automation",
        "https://dms.antelopejs.com/docs/modules/automation/extending",
      ],
    ),
  ]);
});

void test("what each package declares to AntelopeJS: fails on a missing implements, skills folder or built entry point", async (t) => {
  await assertChecks(t, "what each package declares to AntelopeJS", [
    same(
      "the module implements the interface",
      obj(module_.antelopeJs).implements,
      ["@antelopejs/interface-dms-automation"],
    ),
    same(
      "the module declares its skills folder",
      obj(module_.antelopeJs).skills,
      ["./skills"],
    ),
    same(
      "the interface declares its skills folder",
      obj(iface.antelopeJs).skills,
      ["./skills"],
    ),
    same(
      "the module's baseUrl is dist",
      obj(module_.antelopeJs).baseUrl,
      "dist",
    ),
    same(
      "the frontend module is the built one",
      [module_.dmsFrontend, exists(`${MODULE}/dist/frontend-module.js`)],
      ["dist/frontend-module.js", true],
    ),
    same(
      "main and types",
      [module_.main, module_.types, iface.main, iface.types],
      ["dist/index.js", "dist/index.d.ts", "dist/index.js", "dist/index.d.ts"],
    ),
    same(
      "the skills folders exist with a skill each",
      [
        exists(`${MODULE}/skills/dms-automation/SKILL.md`),
        exists(`${INTERFACE}/skills/dms-automation-interface/SKILL.md`),
      ],
      [true, true],
    ),
  ]);
});

void test("the README compatibility tables: fails on a supported range that is not the declared one or a missing row", async (t) => {
  const moduleRows = compatRows(read(`${MODULE}/README.md`));
  const interfaceRows = compatRows(read(`${INTERFACE}/README.md`));
  const interfaceRow = moduleRows.find(
    (row) => row.name === "@antelopejs/interface-dms-automation",
  );
  await assertChecks(t, "the module's range on the interface", [
    same(
      "package.json names the sibling interface with workspace:^, which pnpm pack writes as ^<interface version>",
      normalRange(String(moduleDeps["@antelopejs/interface-dms-automation"])),
      "workspace:^",
    ),
    same(
      "the README says the same, supported",
      normalRange(interfaceRow?.supported ?? ""),
      `^${interfaceVersion}`,
    ),
    same(
      "the README tested-with is the interface version",
      interfaceRow?.tested,
      interfaceVersion,
    ),
  ]);
  /** @type {(import("./helpers/checks.cjs").Check | import("./helpers/checks.cjs").Same)[]} */
  const rowChecks = [];
  for (const row of moduleRows) {
    const declared =
      moduleDeps[row.name] === "workspace:^"
        ? `^${interfaceVersion}`
        : String(moduleDeps[row.name]);
    rowChecks.push(
      same(
        `module README row ${row.name}: supported is the declared range`,
        row.supported,
        declared,
      ),
    );
  }
  const peer = obj(iface.peerDependencies);
  for (const row of interfaceRows)
    rowChecks.push(
      same(
        `interface README row ${row.name}: supported is the peer range`,
        row.supported,
        String(peer[row.name]),
      ),
    );
  rowChecks.push(
    same(
      "every runtime interface dependency of the module has a row",
      Object.keys({
        ...obj(module_.dependencies),
        ...obj(module_.optionalDependencies),
      }).filter(
        (name) =>
          name.startsWith("@antelopejs/interface-") &&
          !moduleRows.some((row) => row.name === name),
      ),
      [],
    ),
    same(
      "the interface's only peer has a row",
      Object.keys(peer).filter(
        (name) => !interfaceRows.some((row) => row.name === name),
      ),
      [],
    ),
  );
  await assertChecks(t, "the README compatibility tables", rowChecks);
});

void test("ranges quoted in the docs: fails on a docs range the release does not give", async (t) => {
  const interfaceRows = compatRows(read(`${INTERFACE}/README.md`));
  const peer = obj(iface.peerDependencies);
  const extending = read(`${MODULE}/docs/5.extending.md`);
  const installation = read(`${MODULE}/docs/2.installation.md`);
  const interfaceReadme = read(`${INTERFACE}/README.md`);
  const minorFloor = (/** @type {string} */ version) =>
    `>=${parts(version).major}.${parts(version).minor}.0 <1.0.0`;
  await assertChecks(t, "ranges quoted in the docs", [
    same(
      "the consumer range in Extending",
      /"@antelopejs\/interface-dms-automation": "([^"]+)"/.exec(extending)?.[1],
      minorFloor(interfaceVersion),
    ),
    same(
      "the module range in Installation",
      /version: "([^"]+)"/.exec(installation)?.[1],
      minorFloor(String(module_.version)),
    ),
    check(
      "the interface README says a wide range from the release up to <1.0.0",
      /up to `<1\.0\.0`/.test(interfaceReadme),
      interfaceReadme.slice(0, 0),
    ),
    same(
      "the interface README's peer row is its peer dependency",
      normalRange(interfaceRows[0]?.supported ?? ""),
      normalRange(String(peer["@antelopejs/interface-core"])),
    ),
  ]);
});

void test("the renderer range: fails on a missing or unmatched renderer range", async (t) => {
  const frontend = readJson(`${MODULE}/frontend-vue/package.json`);
  const renderer = obj(frontend.engines)["@antelopejs/dms-frontend"];
  await assertChecks(t, "the renderer range", [
    check(
      "the frontend module declares a renderer range",
      isText(renderer) && renderer.length > 0,
      renderer,
    ),
    same(
      "it is the range the frontend builds against",
      renderer,
      obj(frontend.devDependencies)["@antelopejs/dms-frontend"],
    ),
    same(
      "the docs name that field",
      /engines\["@antelopejs\/dms-frontend"\]/.test(
        read(`${MODULE}/docs/1.introduction.md`),
      ) &&
        /engines\["@antelopejs\/dms-frontend"\]/.test(
          read(`${MODULE}/README.md`),
        ),
      true,
    ),
  ]);
});

void test("the documentation badges: fails on a badge that is not the homepage", async (t) => {
  /** @param {string} readme */
  const docsBadge = (readme) =>
    /href="(https:\/\/dms\.antelopejs\.com\/[^"]+)"><img alt="Documentation"/.exec(
      readme,
    )?.[1];
  await assertChecks(t, "the documentation badges", [
    same("module", docsBadge(read(`${MODULE}/README.md`)), module_.homepage),
    same(
      "interface",
      docsBadge(read(`${INTERFACE}/README.md`)),
      iface.homepage,
    ),
  ]);
});

void test("the CMS-era names are gone: fails on a database, schema or namespace still named after the CMS", async (t) => {
  const constants = read(`${MODULE}/src/types/constants.ts`);
  const renamed = [
    [
      "database",
      constants.match(/DATABASE_NAME = "([^"]+)"/)?.[1],
      "dms-automation",
    ],
    [
      "schema",
      constants.match(/SCHEMA_NAME = "([^"]+)"/)?.[1],
      "dms_automation",
    ],
    [
      "i18n namespace files",
      filesBelow(nodePath.join(ROOT, MODULE, "frontend-vue", "i18n", "locales"))
        .sort()
        .join(","),
      "dms-automation-en-GB.json,dms-automation-fr-FR.json",
    ],
  ];
  await assertChecks(
    t,
    "the CMS-era names are gone, as the Installation note says",
    renamed.map(([what, actual, expected]) =>
      same(`the ${what} is ${expected}`, actual, expected),
    ),
  );
});
