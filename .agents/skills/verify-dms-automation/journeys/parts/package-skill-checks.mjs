import { join } from "node:path";
import { check, isText, same } from "../../auto.mjs";
import { MODULE, filesBelow, read, repoOf } from "./package-files.mjs";
import { obj, strings } from "./package-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */
/** @typedef {import("../../auto.mjs").Row} Row */

/**
 * The checks on the front matter and body of one shipped skill.
 *
 * @param {string} skill The skill's folder name
 * @param {{ frontMatter: Record<string, string>, body: string }} parsed The skill split into front matter and body
 * @param {string} skillText The skill's whole text
 * @param {string} declarations The interface's built declarations
 * @returns {Check[]} The checks
 */
export function frontMatterChecks(skill, parsed, skillText, declarations) {
  const { frontMatter, body } = parsed;
  const description = frontMatter.description ?? "";
  const named = [...description.matchAll(/\b(Register|Unregister|List|Invoke|Run|Declare)[A-Za-z]*(Type|Types|Procedure)\b/g)].map((match) => match[0]);
  const isModuleSkill = skill === "dms-automation";
  return [
    same("name is the folder name", frontMatter.name, skill),
    check("the description says when to use it", /Use when/.test(description) && description.length > 80 && description.length <= 1024, description.length),
    check("icon, category and tags are present", /^i-lucide-[a-z-]+$/.test(frontMatter.icon ?? "") && Boolean(frontMatter.category) && /^\[.+\]$/.test(frontMatter.tags ?? ""), frontMatter),
    same("the body starts with its title", body.trimStart().split("\n")[0], isModuleSkill ? "# dms-automation" : "# DMS Automation Interface"),
    same("the functions its description names are exported by the interface", isModuleSkill ? [] : named.filter((name) => !declarations.includes(name)), []),
    same("the other skill is pointed to by its real name", isModuleSkill ? /`dms-automation-interface` skill/.test(skillText) : /`dms-automation` skill/.test(skillText), true),
  ];
}

/**
 * The checks on one case of a skill's cases.json.
 *
 * @param {Row} entry The case
 * @param {string[]} known The shipped skills' names
 * @param {Record<string, string>} skillTexts Each shipped skill's text by name
 * @param {Set<string>} caseIds The ids seen so far
 * @returns {Check[]} The checks
 */
export function caseChecks(entry, known, skillTexts, caseIds) {
  const id = String(entry.id);
  const expect = obj(entry.expect);
  const skills = strings(expect.skills);
  const acceptable = strings(expect.acceptable);
  const avoid = strings(expect.avoid);
  const mentions = strings(expect.mustMention);
  const target = skills[0] ?? "";
  return [
    check(`${id}: id is kebab-case and unique`, /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) && !caseIds.has(id), id),
    check(`${id}: style, area and prompt`, ["clean", "casual"].includes(String(entry.style)) && entry.area === "modules" && isText(entry.prompt) && entry.prompt.length > 20, entry),
    check(`${id}: expects a shipped skill`, skills.length > 0 && skills.every((name) => known.includes(name)), skills),
    check(
      `${id}: avoid does not overlap expected or acceptable`,
      avoid.every((name) => !skills.includes(name) && !acceptable.includes(name)),
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
 * @returns {Check[]} The checks
 */
export function configKeyChecks(skill, config, source) {
  const section = /## Config[^\n]*\n\n([^\n]+)/.exec(skill)?.[1] ?? "";
  const keys = [...section.matchAll(/`((?:runs|httpRequest|cluster)\.[A-Za-z]+)`/g)].map((match) => match[1]);
  const rows = new Map([...config.matchAll(/^\| `([\w.]+)` \| `([^`]*(?:`[^`]*`)*[^|]*?)` \| `([^`]*)` \|/gm)].map((match) => [match[1], match[3]]));
  return [
    same("the skill names the four keys", keys, ["runs.retentionDays", "runs.sensitiveNames", "httpRequest.blockPrivateNetwork", "cluster.driver"]),
    same(
      "each is a row of the Configuration table",
      keys.filter((key) => !rows.has(key)),
      [],
    ),
    same("the retention default", [/`runs\.retentionDays` \((\d+); 0 keeps all\)/.exec(section)?.[1], rows.get("runs.retentionDays")], ["30", "30"]),
    same("the private network default", [/`httpRequest\.blockPrivateNetwork` \((\w+)\)/.exec(section)?.[1], rows.get("httpRequest.blockPrivateNetwork")], ["false", "false"]),
    same("the cluster driver values", [/`cluster\.driver` \(([^)]+)\)/.exec(section)?.[1], rows.get("cluster.driver")], ["`auto` | `redis` | `memory`", '"auto"']),
    check("the Config type of the module has those keys", /retentionDays\?: number/.test(source) && /sensitiveNames\?: string\[\]/.test(source) && /blockPrivateNetwork\?: boolean/.test(source) && /driver\?: ClusterDriver/.test(source), source.length),
    check("the TSDoc says 30 days and 0 keeps every run", /30 by default\.\s*\*?\s*`0` keeps every\s*\*?\s*run/.test(source), source.length),
  ];
}

/**
 * Every `METHOD /path` the module's controllers declare.
 *
 * @param {Ctx} ctx The journey
 * @returns {Set<string>} The routes
 */
export function declaredRoutes(ctx) {
  const routesDir = join(repoOf(ctx), MODULE, "src", "routes");
  /** @type {Set<string>} */
  const routes = new Set();
  for (const file of filesBelow(routesDir).filter((name) => name.endsWith(".ts"))) {
    const code = read(ctx, `${MODULE}/src/routes/${file}`);
    const base = /Controller\(\s*"([^"]+)"/.exec(code)?.[1];
    if (!base) continue;
    for (const match of code.matchAll(/@(Get|Post|Put|Delete)\("([^"]*)"\)/g)) routes.add(`${match[1].toUpperCase()} ${base}${match[2]}`);
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
 * @returns {Check[]} The checks
 */
export function routeChecks(skill, routes) {
  return [
    same(
      "the skill states each route",
      CLAIMED_ROUTES.filter(([, path]) => !skill.includes(path.replace("/api/automation/procedures", "").replace("/api/automation", "")) && !skill.includes(path)),
      [],
    ),
    same(
      "each exists in the source",
      CLAIMED_ROUTES.filter(([method, path]) => !routes.has(`${method} ${path}`)),
      [],
    ),
    check("the skill gives the import body as { json } and the enable body as { enabled }", /import` `\{ json \}`/.test(skill) && /enabled` `\{ enabled \}`/.test(skill) && /run-now` `\{ payload \}`/.test(skill), skill.length),
  ];
}
