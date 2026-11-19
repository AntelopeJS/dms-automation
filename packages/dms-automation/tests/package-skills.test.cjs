const nodePath = require("node:path");
const { test } = require("node:test");
const {
  check,
  isText,
  list,
  parseJson,
  same,
  assertChecks,
} = require("./helpers/checks.cjs");
const {
  INTERFACE,
  MODULE,
  ROOT,
  SKILL_PACKAGES,
  filesBelow,
  obj,
  read,
  readJson,
  splitFrontMatter,
  strings,
} = require("./helpers/package-files.cjs");

/** @typedef {import("./helpers/checks.cjs").Check | import("./helpers/checks.cjs").Same} Verdict */

/**
 * The checks on the front matter and body of one shipped skill.
 *
 * @param {string} skill The skill's folder name
 * @param {{ frontMatter: Record<string, string>, body: string }} parsed The skill split into front matter and body
 * @param {string} skillText The skill's whole text
 * @param {string} declarations The interface's built declarations
 * @returns {Verdict[]} The checks
 */
function frontMatterChecks(skill, parsed, skillText, declarations) {
  const { frontMatter, body } = parsed;
  const description = frontMatter.description ?? "";
  const named = [
    ...description.matchAll(
      /\b(Register|Unregister|List|Invoke|Run|Declare)[A-Za-z]*(Type|Types|Procedure)\b/g,
    ),
  ].map((match) => match[0]);
  const isModuleSkill = skill === "dms-automation";
  return [
    same("name is the folder name", frontMatter.name, skill),
    check(
      "the description says when to use it",
      /Use when/.test(description) &&
        description.length > 80 &&
        description.length <= 1024,
      description.length,
    ),
    check(
      "icon, category and tags are present",
      /^i-lucide-[a-z-]+$/.test(frontMatter.icon ?? "") &&
        Boolean(frontMatter.category) &&
        /^\[.+\]$/.test(frontMatter.tags ?? ""),
      frontMatter,
    ),
    same(
      "the body starts with its title",
      body.trimStart().split("\n")[0],
      isModuleSkill ? "# dms-automation" : "# DMS Automation Interface",
    ),
    same(
      "the functions its description names are exported by the interface",
      isModuleSkill ? [] : named.filter((name) => !declarations.includes(name)),
      [],
    ),
    same(
      "the other skill is pointed to by its real name",
      isModuleSkill
        ? /`dms-automation-interface` skill/.test(skillText)
        : /`dms-automation` skill/.test(skillText),
      true,
    ),
  ];
}

/**
 * The checks on one case of a skill's cases.json.
 *
 * @param {Record<string, unknown>} entry The case
 * @param {string[]} known The shipped skills' names
 * @param {Record<string, string>} skillTexts Each shipped skill's text by name
 * @param {Set<string>} caseIds The ids seen so far
 * @returns {Verdict[]} The checks
 */
function caseChecks(entry, known, skillTexts, caseIds) {
  const id = String(entry.id);
  const expect = obj(entry.expect);
  const skills = strings(expect.skills);
  const acceptable = strings(expect.acceptable);
  const avoid = strings(expect.avoid);
  const mentions = strings(expect.mustMention);
  const target = skills[0] ?? "";
  return [
    check(
      `${id}: id is kebab-case and unique`,
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) && !caseIds.has(id),
      id,
    ),
    check(
      `${id}: style, area and prompt`,
      ["clean", "casual"].includes(String(entry.style)) &&
        entry.area === "modules" &&
        isText(entry.prompt) &&
        entry.prompt.length > 20,
      entry,
    ),
    check(
      `${id}: expects a shipped skill`,
      skills.length > 0 && skills.every((name) => known.includes(name)),
      skills,
    ),
    check(
      `${id}: avoid does not overlap expected or acceptable`,
      avoid.every(
        (name) => !skills.includes(name) && !acceptable.includes(name),
      ),
      expect,
    ),
    same(
      `${id}: every phrase to mention is in the expected skill`,
      mentions.filter((phrase) => !(skillTexts[target] ?? "").includes(phrase)),
      [],
    ),
  ];
}

/**
 * The config keys the module skill names, against the Configuration table and the Config type.
 *
 * @param {string} skill The module skill's text
 * @param {string} config docs/3.configuration.md
 * @param {string} source src/index.ts
 * @returns {Verdict[]} The checks
 */
function configKeyChecks(skill, config, source) {
  const section = /## Config[^\n]*\n\n([^\n]+)/.exec(skill)?.[1] ?? "";
  const keys = [
    ...section.matchAll(/`((?:runs|httpRequest|cluster)\.[A-Za-z]+)`/g),
  ].map((match) => match[1]);
  const rows = new Map(
    [
      ...config.matchAll(
        /^\| `([\w.]+)` \| `([^`]*(?:`[^`]*`)*[^|]*?)` \| `([^`]*)` \|/gm,
      ),
    ].map((match) => [match[1], match[3]]),
  );
  return [
    same("the skill names the four keys", keys, [
      "runs.retentionDays",
      "runs.sensitiveNames",
      "httpRequest.blockPrivateNetwork",
      "cluster.driver",
    ]),
    same(
      "each is a row of the Configuration table",
      keys.filter((key) => !rows.has(key)),
      [],
    ),
    same(
      "the retention default",
      [
        /`runs\.retentionDays` \((\d+); 0 keeps all\)/.exec(section)?.[1],
        rows.get("runs.retentionDays"),
      ],
      ["30", "30"],
    ),
    same(
      "the private network default",
      [
        /`httpRequest\.blockPrivateNetwork` \((\w+)\)/.exec(section)?.[1],
        rows.get("httpRequest.blockPrivateNetwork"),
      ],
      ["false", "false"],
    ),
    same(
      "the cluster driver values",
      [
        /`cluster\.driver` \(([^)]+)\)/.exec(section)?.[1],
        rows.get("cluster.driver"),
      ],
      ["`auto` | `redis` | `memory`", '"auto"'],
    ),
    check(
      "the Config type of the module has those keys",
      /retentionDays\?: number/.test(source) &&
        /sensitiveNames\?: string\[\]/.test(source) &&
        /blockPrivateNetwork\?: boolean/.test(source) &&
        /driver\?: ClusterDriver/.test(source),
      source.length,
    ),
    check(
      "the TSDoc says 30 days and 0 keeps every run",
      /30 by default\.\s*\*?\s*`0` keeps every\s*\*?\s*run/.test(source),
      source.length,
    ),
  ];
}

/**
 * Every `METHOD /path` the module's controllers declare.
 *
 * @returns {Set<string>} The routes
 */
function declaredRoutes() {
  const routesDir = nodePath.join(ROOT, MODULE, "src", "routes");
  /** @type {Set<string>} */
  const routes = new Set();
  for (const file of filesBelow(routesDir).filter((name) =>
    name.endsWith(".ts"),
  )) {
    const code = read(`${MODULE}/src/routes/${file}`);
    const base = /Controller\(\s*"([^"]+)"/.exec(code)?.[1];
    if (!base) continue;
    for (const match of code.matchAll(/@(Get|Post|Put|Delete)\("([^"]*)"\)/g))
      routes.add(`${match[1].toUpperCase()} ${base}${match[2]}`);
  }
  return routes;
}

const CLAIMED_ROUTES = [
  ["POST", "/api/automation/procedures/import"],
  ["PUT", "/api/automation/procedures/:id/enabled"],
  ["POST", "/api/automation/procedures/:id/run-now"],
  ["POST", "/api/automation/procedures/:id/test"],
  ["POST", "/api/automation/procedures/:id/test-effects"],
  ["GET", "/api/automation/stats/runs-per-day"],
];

/**
 * The routes the module skill states, against the controllers.
 *
 * @param {string} skill The module skill's text
 * @param {Set<string>} routes The declared routes
 * @returns {Verdict[]} The checks
 */
function routeChecks(skill, routes) {
  return [
    same(
      "the skill states each route",
      CLAIMED_ROUTES.filter(
        ([, path]) =>
          !skill.includes(
            path
              .replace("/api/automation/procedures", "")
              .replace("/api/automation", ""),
          ) && !skill.includes(path),
      ),
      [],
    ),
    same(
      "each exists in the source",
      CLAIMED_ROUTES.filter(
        ([method, path]) => !routes.has(`${method} ${path}`),
      ),
      [],
    ),
    check(
      "the skill gives the import body as { json } and the enable body as { enabled }",
      /import` `\{ json \}`/.test(skill) &&
        /enabled` `\{ enabled \}`/.test(skill) &&
        /run-now` `\{ payload \}`/.test(skill),
      skill.length,
    ),
  ];
}

void test("shipped skills: fails on a wrong front matter or a case that names a missing skill or phrase", async (t) => {
  const known = SKILL_PACKAGES.map((entry) => entry.skill);
  const skillTexts = Object.fromEntries(
    SKILL_PACKAGES.map((entry) => [
      entry.skill,
      read(`${entry.folder}/skills/${entry.skill}/SKILL.md`),
    ]),
  );
  /** @type {Set<string>} */
  const caseIds = new Set();
  for (const { folder, skill } of SKILL_PACKAGES) {
    const ownIface = read(`${INTERFACE}/dist/index.d.ts`);
    await assertChecks(
      t,
      `${skill} front matter`,
      frontMatterChecks(
        skill,
        splitFrontMatter(skillTexts[skill]),
        skillTexts[skill],
        ownIface,
      ),
    );
    const cases = obj(readJson(`${folder}/skills/${skill}/cases.json`));
    const caseList = list(cases, "cases");
    /** @type {Verdict[]} */
    const checks = [
      same("version 1", cases.version, 1),
      check("there are cases", caseList.length > 0, caseList.length),
    ];
    for (const entry of caseList) {
      checks.push(...caseChecks(entry, known, skillTexts, caseIds));
      caseIds.add(String(entry.id));
    }
    await assertChecks(t, `${skill} cases`, checks);
  }
});

void test("module skill statements: fails on a config key, route, page path, webhook prefix or state the docs and source lack", async (t) => {
  const skill = read(`${MODULE}/skills/dms-automation/SKILL.md`);
  const config = read(`${MODULE}/docs/3.configuration.md`);
  const source = read(`${MODULE}/src/index.ts`);
  await assertChecks(t, "config keys", configKeyChecks(skill, config, source));
  await assertChecks(t, "API routes", routeChecks(skill, declaredRoutes()));
  const shared = read(`${MODULE}/src/pages/shared.ts`);
  await assertChecks(t, "pages", [
    same(
      "the module URL",
      /MODULE_URL = "([^"]+)"/.exec(shared)?.[1],
      "/modules/automation",
    ),
    same(
      "the builder and trace paths the skill gives",
      [
        /BUILDER_URL = `\$\{MODULE_URL\}(\/\w+)`/.exec(shared)?.[1],
        /TRACE_URL = `\$\{MODULE_URL\}(\/\w+)`/.exec(shared)?.[1],
      ],
      ["/builder", "/trace"],
    ),
    check(
      "the skill states them",
      skill.includes("/modules/automation/builder?selected=<id>") &&
        skill.includes("/modules/automation/trace?run=<id>"),
      skill.length,
    ),
  ]);
  const webhook = read(`${MODULE}/src/runtime/builtins/triggers/webhook.ts`);
  const reserved = parseJson(
    /RESERVED_PREFIXES = (\[[^\]]*\])/.exec(webhook)?.[1] ?? "[]",
  );
  const stated = [
    ...(
      /Webhook paths cannot overlap an existing route or start with ([^;.]+)/.exec(
        skill,
      )?.[1] ?? ""
    ).matchAll(/`([^`]+)`/g),
  ].map((match) => match[1]);
  const documented = [
    ...(
      /The path is ([^\n]+?), or starts with/.exec(config)?.[1] ?? ""
    ).matchAll(/`([^`]+)`/g),
  ].map((match) => match[1]);
  await assertChecks(t, "reserved webhook prefixes", [
    same("the skill's list is the code's", stated, reserved),
    same("the docs' list is the code's", documented, reserved),
  ]);
  const states = ["failing", "degraded", "healthy", "paused", "draft"];
  await assertChecks(t, "states", [
    same(
      "the skill's states in order",
      /States: ([^.]+)\./
        .exec(skill)?.[1]
        ?.replace(/ \([^)]*\)/g, "")
        .split(", "),
      states,
    ),
  ]);
});
