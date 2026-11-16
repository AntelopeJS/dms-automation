import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { isRow, list, parseJson, text } from "../../auto.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */
/** @typedef {Record<string, unknown>} Json */

export const MODULE = "packages/dms-automation";
export const INTERFACE = "packages/interface-dms-automation";

/**
 * @param {Ctx} ctx The journey
 * @returns {string} The checkout's root
 */
export function repoOf(ctx) {
  return String(ctx.state.repo);
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} path A path under the checkout
 * @returns {string} Its text
 */
export function read(ctx, path) {
  return readFileSync(join(repoOf(ctx), path), "utf8");
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} path A path under the checkout
 * @returns {boolean} Whether it exists
 */
export function exists(ctx, path) {
  return existsSync(join(repoOf(ctx), path));
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} path A JSON file under the checkout
 * @returns {Json} Its value
 */
export function readJson(ctx, path) {
  const value = parseJson(read(ctx, path));
  return isRow(value) ? value : {};
}

/**
 * @param {string} root A folder
 * @param {(path: string) => boolean} [skip] Which entries to leave out
 * @returns {string[]} Every file below it, relative to it
 */
export function filesBelow(root, skip = () => false) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} folder */
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (skip(relative(root, full))) continue;
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  if (existsSync(root) && statSync(root).isDirectory()) walk(root);
  return out;
}

/**
 * The files `npm pack` would put in a package's tarball.
 *
 * @param {Ctx} ctx The journey
 * @param {string} folder The package folder under the checkout
 * @returns {{ name: string, version: string, files: string[], error: string }} The tarball's description
 */
export function packedFiles(ctx, folder) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: join(repoOf(ctx), folder),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
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
export function splitFrontMatter(markdown) {
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
export function anchorsOf(markdown) {
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
export function codeBlocks(markdown) {
  return [...markdown.matchAll(/```(\w*)([^\n]*)\n([\s\S]*?)```/g)].map((match) => ({ language: match[1], info: match[2].trim(), body: match[3] }));
}

/**
 * @param {string} range A semver range like `>=0.6.0 <0.7.0`
 * @returns {string} The range with blanks normalised
 */
export function normalRange(range) {
  return range.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} version A semver `x.y.z`
 * @returns {{ major: number, minor: number, patch: number }} Its parts
 */
export function parts(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return { major, minor, patch };
}

/**
 * The rows of the compatibility table between the `antelopejs-docs-compat` markers.
 *
 * @param {string} readme A README
 * @returns {{ name: string, supported: string, tested: string }[]} The rows
 */
export function compatRows(readme) {
  const block = /<!-- antelopejs-docs-compat:start -->([\s\S]*?)<!-- antelopejs-docs-compat:end -->/.exec(readme)?.[1] ?? "";
  return block
    .split("\n")
    .filter((line) => /^\|\s*`/.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim().replace(/^`|`$/g, ""));
      return { name: cells[1], supported: cells[2], tested: cells[3] };
    });
}

export { resolve };
