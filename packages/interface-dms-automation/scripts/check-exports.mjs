// The exports map and the typesVersions map have to describe the same package:
// `exports` answers node16 and bundler resolution, `typesVersions` answers the
// node10 consumers that ignore `exports` entirely. Node does not fall back to a
// directory index inside an exports map and a `./*` pattern only matches files,
// so every directory index needs its own entry — today `dist/` is flat and this
// is a tripwire for the first subdirectory someone adds.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const distRoot = path.join(packageRoot, "dist");

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

if (!fs.existsSync(distRoot)) {
  throw new Error(
    "dist is missing: run `pnpm run build` before checking the exports map.",
  );
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function toSubpath(file) {
  const relative = path
    .relative(distRoot, file)
    .split(path.sep)
    .join("/")
    .replace(/\.js$/, "");
  return relative === "index" ? "." : `./${relative.replace(/\/index$/, "")}`;
}

const exportsMap = manifest.exports ?? {};
const explicit = new Set(
  Object.keys(exportsMap).filter((subpath) => !subpath.includes("*")),
);

// 1. The types-only `./dist/*` twin. A node10 consumer resolves a subpath
// through typesVersions, and TypeScript then writes the resolved `dist/<sub>`
// form into the declarations it emits; whoever consumes THAT module needs the
// exports map to answer for it.
check(
  JSON.stringify(exportsMap["./dist/*"]) ===
    JSON.stringify({ types: "./dist/*.d.ts" }),
  'exports["./dist/*"] must be { "types": "./dist/*.d.ts" } so re-emitted declarations resolve.',
);

// 2. The typesVersions shape, verbatim: the `dist/*` entry has to come first so
// the `types` field (`dist/index.d.ts`) keeps resolving through it instead of
// being rewritten by the catch-all, and both entries need the directory-index
// fallback.
const expectedTypesVersions = {
  "dist/*": ["dist/*", "dist/*/index.d.ts"],
  "*": ["dist/*", "dist/*/index.d.ts"],
};
check(
  JSON.stringify(manifest.typesVersions?.["*"]) ===
    JSON.stringify(expectedTypesVersions),
  `typesVersions["*"] must be exactly ${JSON.stringify(expectedTypesVersions)}, in that key order.`,
);

// 3. One explicit entry per directory index, under both the canonical subpath
// and its `./dist` twin.
const jsFiles = listFiles(distRoot).filter((file) => file.endsWith(".js"));
const directoryIndexes = jsFiles
  .filter((file) => path.basename(file) === "index.js")
  .map(toSubpath);
for (const subpath of directoryIndexes) {
  const twin = subpath === "." ? "./dist" : `./dist${subpath.slice(1)}`;
  check(
    explicit.has(subpath),
    `exports needs an explicit "${subpath}" entry: a "./*" pattern never matches a directory index.`,
  );
  check(
    subpath === "." || explicit.has(twin),
    `exports needs an explicit "${twin}" entry so re-emitted declarations resolve the directory index.`,
  );
}

// 4. Every explicit entry points at something that exists.
const scopedRequire = createRequire(path.join(packageRoot, "package.json"));
for (const subpath of explicit) {
  if (subpath === "./package.json") continue;
  const target = exportsMap[subpath];
  // The `dist/...` aliases carry types only: a node10 consumer's declaration
  // emit writes that form, but its JavaScript keeps the canonical specifier,
  // so there is nothing to require.
  if (target.default === undefined) {
    check(
      fs.existsSync(path.join(packageRoot, target.types)),
      `exports["${subpath}"] points at ${target.types}, which does not exist.`,
    );
    continue;
  }
  const specifier =
    subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
  try {
    scopedRequire.resolve(specifier);
  } catch (error) {
    check(
      false,
      `exports["${subpath}"] does not resolve: ${error.code ?? error.message}`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(
    `${manifest.name} exports map is wrong:\n  ${failures.join("\n  ")}`,
  );
}

console.log(
  `exports and typesVersions cover ${jsFiles.length} built modules and ${directoryIndexes.length} directory indexes.`,
);
