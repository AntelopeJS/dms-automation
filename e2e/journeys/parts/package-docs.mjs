import { join } from "node:path";
import { check, same } from "../../auto.mjs";
import { INTERFACE, MODULE, anchorsOf, exists, filesBelow, read, repoOf, splitFrontMatter } from "./package-files.mjs";
import { byText, statDirectory } from "./package-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */

/**
 * The repository file a markdown link points to.
 *
 * @param {string} target The link's target
 * @param {string} source The file holding the link
 * @param {Map<string, string>} pageFiles The docs page file by site slug
 * @returns {string | undefined} The file, `missing` for a target nothing can resolve to, undefined for a link that is not checked
 */
function linkedFile(target, source, pageFiles) {
  const [pathPart] = target.split("#");
  const site = /^(?:https:\/\/dms\.antelopejs\.com)?\/docs\/modules\/automation(?:\/(.*))?$/.exec(pathPart);
  const repo = /^https:\/\/github\.com\/AntelopeJS\/dms-automation\/(?:tree|blob)\/main\/(.*)$/.exec(pathPart);
  if (target.startsWith("#")) return source;
  if (site) {
    const slug = site[1] ?? "";
    return slug === "" ? undefined : (pageFiles.get(slug) ?? "missing");
  }
  if (repo) return repo[1];
  if (/^https?:\/\//.test(target) || target.startsWith("/docs/modules/")) return undefined;
  if (pathPart.startsWith("/")) return "missing";
  const folder = source.split("/").slice(0, -1).join("/");
  return join(folder, pathPart).replace(/\\/g, "/");
}

/**
 * The checks on every link and image of one markdown file.
 *
 * @param {Ctx} ctx The journey
 * @param {string} source The markdown file under the checkout
 * @param {Map<string, string>} pageFiles The docs page file by site slug
 * @returns {{ count: number, checks: Check[] }} The links seen and the checks
 */
function linkChecks(ctx, source, pageFiles) {
  const markdown = read(ctx, source);
  const own = anchorsOf(markdown);
  const folder = source.split("/").slice(0, -1).join("/");
  /** @type {Check[]} */
  const checks = [];
  let count = 0;
  for (const match of markdown.replace(/```[\s\S]*?```/g, "").matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    count += 1;
    const file = linkedFile(target, source, pageFiles);
    if (file === undefined) continue;
    const anchor = target.split("#")[1];
    const isDirectory = exists(ctx, file) && statDirectory(ctx, file);
    const found = file !== "missing" && exists(ctx, file);
    checks.push(check(`${source}: ${target} points to something that exists`, found, file));
    if (anchor && found) {
      const document = isDirectory ? `${file}/README.md` : file;
      const anchors = document === source ? own : exists(ctx, document) && document.endsWith(".md") ? anchorsOf(read(ctx, document)) : new Set();
      checks.push(check(`${source}: ${target} anchor exists in ${document}`, anchors.has(anchor), [...anchors].slice(0, 12)));
    }
  }
  for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const image = join(folder, match[1]).replace(/\\/g, "/");
    checks.push(check(`${source}: image ${match[1]} exists`, exists(ctx, image), image));
  }
  return { count, checks };
}

export const docsJourneys = [
  {
    id: "docs-pages-have-front-matter-and-a-navigation-order",
    title: "every docs page has a title, a description and a mode, the numbered files run 1..n with the Usage folder, and the page titles are the ones the README links name",
    entryPoint: "packages/dms-automation/docs/**, packages/interface-dms-automation/docs",
    async run(/** @type {Ctx} */ ctx) {
      const root = join(repoOf(ctx), MODULE, "docs");
      const top = filesBelow(root, (path) => path.startsWith("images") || path.startsWith("design") || path.endsWith(".navigation.yml")).sort();
      const pages = [
        ...top,
        ...filesBelow(join(repoOf(ctx), INTERFACE, "docs"))
          .filter((file) => file.endsWith(".md"))
          .map((file) => `../../interface-dms-automation/docs/${file}`),
      ].filter((file) => file.endsWith(".md"));
      /** @type {Check[]} */
      const checks = [];
      const titles = new Map();
      for (const page of pages) {
        const path = page.startsWith("../..") ? `${INTERFACE}/docs/${page.split("/").pop()}` : `${MODULE}/docs/${page}`;
        const { frontMatter } = splitFrontMatter(read(ctx, path));
        checks.push(
          check(`${page}: title, description and mode`, Boolean(frontMatter.title) && (frontMatter.description ?? "").length > 20 && ["explanation", "how-to", "reference", "tutorial"].includes(frontMatter.mode ?? ""), frontMatter),
          check(`${page}: the description is one sentence ending with a full stop`, (frontMatter.description ?? "").endsWith("."), frontMatter.description),
        );
        titles.set(frontMatter.title, page);
      }
      checks.push(same("the titles are unique", titles.size, pages.length));
      const numbered = top.filter((file) => !file.includes("/")).map((file) => Number(file.split(".")[0]));
      const usage = top.filter((file) => file.startsWith("4.usage/")).map((file) => Number(file.split("/")[1].split(".")[0]));
      const groups = [`${MODULE}/docs/.navigation.yml`, `${MODULE}/docs/4.usage/.navigation.yml`].map((path) => read(ctx, path));
      await ctx.verify("front matter", checks);
      await ctx.verify("navigation order", [
        same("top-level pages are numbered 1 to 6 without a gap, 4 being the usage folder", [...numbered, 4].sort(byText), [1, 2, 3, 4, 5, 6]),
        same("usage pages are numbered 1 to 5", usage.sort(byText), [1, 2, 3, 4, 5]),
        same("page slugs", top.map((file) => file.replace(/\d+\./g, "").replace(/\.md$/, "")).sort(), ["configuration", "extending", "faq", "installation", "introduction", "usage/builder", "usage/library", "usage/overview", "usage/procedures", "usage/runs"]),
        same("the navigation groups", groups, ["title: Automation\nicon: i-lucide-workflow\n", "title: Usage\nicon: i-lucide-mouse-pointer-click\n"]),
        same(
          "the titles the README documentation list shows",
          ["Introduction", "Installation", "Configuration", "Overview", "Extending", "FAQ"].map((title) => titles.has(title)),
          [true, true, true, true, true, true],
        ),
      ]);
    },
  },
  {
    id: "docs-and-readme-links-and-anchors-resolve",
    title: "every link of the docs, READMEs, and skills to a page, a heading, a file or an image of this repository resolves",
    entryPoint: "packages/*/docs, packages/*/README.md, README.md, skills/*/SKILL.md",
    async run(/** @type {Ctx} */ ctx) {
      const moduleDocs = filesBelow(join(repoOf(ctx), MODULE, "docs"), (path) => path.startsWith("images") || path.startsWith("design")).filter((file) => file.endsWith(".md"));
      /** @type {Map<string, string>} */
      const pageFiles = new Map(moduleDocs.map((file) => [file.replace(/\d+\./g, "").replace(/\.md$/, ""), `${MODULE}/docs/${file}`]));
      pageFiles.set("reference", `${INTERFACE}/docs/1.index.md`);
      const sources = [...moduleDocs.map((file) => `${MODULE}/docs/${file}`), `${INTERFACE}/docs/1.index.md`, `${MODULE}/README.md`, `${INTERFACE}/README.md`, "README.md", `${MODULE}/skills/dms-automation/SKILL.md`, `${INTERFACE}/skills/dms-automation-interface/SKILL.md`].filter((path) => exists(ctx, path));
      /** @type {Check[]} */
      const checks = [];
      let count = 0;
      for (const source of sources) {
        const found = linkChecks(ctx, source, pageFiles);
        count += found.count;
        checks.push(...found.checks);
      }
      await ctx.verify("links", [check("there are links to check", count > 40, count), ...checks.filter((entry) => !entry.pass), same("every link and anchor resolved", checks.filter((entry) => !entry.pass).length, 0)]);
    },
  },
];
