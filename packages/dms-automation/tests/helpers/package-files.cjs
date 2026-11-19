const nodeChild = require("node:child_process");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { isRow, isText, list, parseJson, text } = require("./checks.cjs");

/** @typedef {Record<string, unknown>} Json */

const ROOT = nodePath.resolve(__dirname, "../../../..");
const MODULE = "packages/dms-automation";
const INTERFACE = "packages/interface-dms-automation";

const SKILL_PACKAGES = [
  { folder: MODULE, skill: "dms-automation" },
  { folder: INTERFACE, skill: "dms-automation-interface" },
];

/**
 * @param {string} path A path under the checkout
 * @returns {string} Its text
 */
function read(path) {
  return nodeFs.readFileSync(nodePath.join(ROOT, path), "utf8");
}

/**
 * @param {string} path A path under the checkout
 * @returns {boolean} Whether it exists
 */
function exists(path) {
  return nodeFs.existsSync(nodePath.join(ROOT, path));
}

/**
 * @param {string} path A JSON file under the checkout
 * @returns {Json} Its value
 */
function readJson(path) {
  const value = parseJson(read(path));
  return isRow(value) ? value : {};
}

/**
 * @param {string} folder A package folder under the checkout
 * @returns {Json} Its package.json
 */
function manifestOf(folder) {
  return readJson(`${folder}/package.json`);
}

/**
 * @param {unknown} value Any value
 * @returns {Json} The value as an object, empty for anything else
 */
function obj(value) {
  return isRow(value) ? value : {};
}

/**
 * @param {unknown} value Any value
 * @returns {string[]} The elements as text when it is an array, else none
 */
function strings(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * The code-unit order `Array.prototype.sort` uses by default, as a comparator.
 *
 * @param {unknown} left A value
 * @param {unknown} right Another value
 * @returns {number} Negative, zero or positive
 */
function byText(left, right) {
  const a = String(left);
  const b = String(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * @param {string} root An absolute folder
 * @param {(path: string) => boolean} [skip] Which entries to leave out
 * @returns {string[]} Every file below it, relative to it
 */
function filesBelow(root, skip = () => false) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} folder */
  const walk = (folder) => {
    for (const entry of nodeFs.readdirSync(folder, { withFileTypes: true })) {
      const full = nodePath.join(folder, entry.name);
      if (skip(nodePath.relative(root, full))) continue;
      if (entry.isDirectory()) walk(full);
      else out.push(nodePath.relative(root, full));
    }
  };
  if (nodeFs.existsSync(root) && nodeFs.statSync(root).isDirectory())
    walk(root);
  return out;
}

/**
 * @param {string} path A path under the checkout
 * @returns {boolean} Whether it is a folder holding files
 */
function statDirectory(path) {
  return filesBelow(nodePath.join(ROOT, path)).length > 0;
}

/**
 * The export targets a manifest names, as paths relative to the package.
 *
 * @param {Json} manifest The package.json
 * @returns {string[]} The targets that have no `*`
 */
function exportTargets(manifest) {
  /** @type {string[]} */
  const targets = [];
  /** @param {unknown} value */
  const walk = (value) => {
    if (isText(value)) targets.push(value);
    else for (const inner of Object.values(obj(value))) walk(inner);
  };
  walk(manifest.exports);
  return targets
    .filter((target) => !target.includes("*"))
    .map((target) => target.replace(/^\.\//, ""));
}

/**
 * The files `npm pack` would put in a package's tarball.
 *
 * @param {string} folder The package folder under the checkout
 * @returns {{ name: string, version: string, files: string[], error: string }} The tarball's description
 */
function packedFiles(folder) {
  const result = nodeChild.spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: nodePath.join(ROOT, folder),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const parsed = list(parseJson(result.stdout))[0];
  if (!parsed)
    return {
      name: "",
      version: "",
      files: [],
      error: result.stderr.slice(0, 300),
    };
  return {
    name: text(parsed, "name"),
    version: text(parsed, "version"),
    files: list(parsed, "files").map((file) => text(file, "path")),
    error: "",
  };
}

/**
 * @param {string} markdown A markdown document
 * @returns {{ frontMatter: Record<string, string>, body: string }} Its front matter and body
 */
function splitFrontMatter(markdown) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  /** @type {Record<string, string>} */
  const frontMatter = {};
  for (const line of (match?.[1] ?? "").split("\n")) {
    const at = line.indexOf(": ");
    if (at > 0) frontMatter[line.slice(0, at)] = line.slice(at + 2);
  }
  return {
    frontMatter,
    body: match ? markdown.slice(match[0].length) : markdown,
  };
}

/**
 * The headings of a markdown document as anchors, code blocks left out.
 *
 * @param {string} markdown The document
 * @returns {Set<string>} The anchors
 */
function anchorsOf(markdown) {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  /** @type {Set<string>} */
  const anchors = new Set();
  for (const match of withoutCode.matchAll(/^#{1,6} +(.+)$/gm)) {
    anchors.add(
      match[1]
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-"),
    );
  }
  return anchors;
}

/**
 * @param {string} markdown The document
 * @returns {{ language: string, info: string, body: string }[]} Its fenced code blocks
 */
function codeBlocks(markdown) {
  return [...markdown.matchAll(/```(\w*)([^\n]*)\n([\s\S]*?)```/g)].map(
    (match) => ({
      language: match[1],
      info: match[2].trim(),
      body: match[3],
    }),
  );
}

/**
 * @param {string} range A semver range like `>=0.6.0 <0.7.0`
 * @returns {string} The range with blanks normalised
 */
function normalRange(range) {
  return range.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} version A semver `x.y.z`
 * @returns {{ major: number, minor: number, patch: number }} Its parts
 */
function parts(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return { major, minor, patch };
}

/**
 * The rows of the compatibility table between the `antelopejs-docs-compat` markers.
 *
 * @param {string} readme A README
 * @returns {{ name: string, supported: string, tested: string }[]} The rows
 */
function compatRows(readme) {
  const block =
    /<!-- antelopejs-docs-compat:start -->([\s\S]*?)<!-- antelopejs-docs-compat:end -->/.exec(
      readme,
    )?.[1] ?? "";
  return block
    .split("\n")
    .filter((line) => /^\|\s*`/.test(line))
    .map((line) => {
      const cells = line
        .split("|")
        .map((cell) => cell.trim().replace(/^`|`$/g, ""));
      return { name: cells[1], supported: cells[2], tested: cells[3] };
    });
}

module.exports = {
  INTERFACE,
  MODULE,
  ROOT,
  SKILL_PACKAGES,
  anchorsOf,
  byText,
  codeBlocks,
  compatRows,
  exists,
  exportTargets,
  filesBelow,
  manifestOf,
  normalRange,
  obj,
  packedFiles,
  parts,
  read,
  readJson,
  splitFrontMatter,
  statDirectory,
  strings,
};
