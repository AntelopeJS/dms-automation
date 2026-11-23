import fs from "node:fs";
import path from "node:path";

const REPOSITORY_URL = "git+https://github.com/AntelopeJS/dms-automation.git";
const INTERFACE_PACKAGE = "@antelopejs/interface-dms-automation";

/**
 * The publication target of this repository, in one place. A release from a
 * directory that is not listed here is a mistake, not a new package.
 */
const PACKAGES = new Map([
  [
    "packages/dms-automation",
    { name: "@antelopejs/dms-automation", role: "runtime" },
  ],
  [
    "packages/interface-dms-automation",
    { name: INTERFACE_PACKAGE, role: "interface" },
  ],
]);

const [packageDirectory] = process.argv.slice(2);
if (packageDirectory === undefined) {
  throw new Error(
    `Usage: node ${path.relative(process.cwd(), process.argv[1])} <package-directory>`,
  );
}

const expected = PACKAGES.get(packageDirectory);
if (expected === undefined) {
  throw new Error(
    `${packageDirectory} is not a publishable package of this repository. Expected one of: ${[...PACKAGES.keys()].join(", ")}.`,
  );
}

const manifestPath = path.join(packageDirectory, "package.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error(
    `${manifestPath} does not exist: the release would publish nothing.`,
  );
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isString(value) {
  return typeof value === "string";
}

/**
 * The value `keys` reaches below `root`, or `undefined` where the path leaves
 * the objects the manifest holds.
 * @param {unknown} root
 * @param {string[]} keys
 * @returns {unknown}
 */
function valueAt(root, ...keys) {
  let current = root;
  for (const key of keys) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/** @type {unknown} */
const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pkgName = valueAt(pkg, "name");
const pkgVersion = valueAt(pkg, "version");

/** @type {string[]} */
const failures = [];
/**
 * @param {boolean} condition
 * @param {string} message
 */
function check(condition, message) {
  if (!condition) failures.push(message);
}

check(
  pkgName === expected.name,
  `name is ${JSON.stringify(pkgName)}: ${packageDirectory} publishes ${expected.name}.`,
);
check(
  valueAt(pkg, "private") !== true,
  "private is true: remove it, a private package cannot be published.",
);
check(
  valueAt(pkg, "license") === "Apache-2.0",
  `license is ${JSON.stringify(valueAt(pkg, "license"))}: every package of this repository ships under Apache-2.0.`,
);
check(
  valueAt(pkg, "repository", "url") === REPOSITORY_URL,
  `repository.url is ${JSON.stringify(valueAt(pkg, "repository", "url"))}: set it to ${REPOSITORY_URL} so provenance points at this repository.`,
);
check(
  valueAt(pkg, "publishConfig", "registry") === "https://registry.npmjs.org/",
  `publishConfig.registry is ${JSON.stringify(valueAt(pkg, "publishConfig", "registry"))}: this package is public, publish it to https://registry.npmjs.org/.`,
);
check(
  valueAt(pkg, "publishConfig", "access") === "public",
  `publishConfig.access is ${JSON.stringify(valueAt(pkg, "publishConfig", "access"))}: a scoped package defaults to restricted, set it to "public".`,
);
check(
  valueAt(pkg, "publishConfig", "provenance") === true,
  "publishConfig.provenance is not true: the shared workflow publishes with npm OIDC and needs provenance enabled.",
);

/**
 * `@antelopejs/core` resolves interface packages by range: a caret range on a
 * 0.0.x version (`^0.0.1` means `>=0.0.1 <0.0.2`) stops satisfying the
 * canonical installed version on the first patch release and the host refuses
 * to boot with "Incompatible interface package resolution". Every DMS package
 * is therefore referenced by an explicit `>=<floor> <1.0.0` range, except the
 * sibling interface, which `workspace:^` has pnpm pack write as `^<version>`; pnpm
 * links the sibling inside the workspace through `link-workspace-packages`.
 */
const DMS_PACKAGE =
  /^@antelopejs\/(dms|dms-.+|interface-dms|interface-dms-.+)$/;
const DMS_RANGE = /^>=\d+\.\d+\.\d+ <\d+\.\d+\.\d+$/;

for (const field of [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]) {
  const group = valueAt(pkg, field);
  if (!isRecord(group)) continue;
  for (const [dependency, range] of Object.entries(group)) {
    if (!DMS_PACKAGE.test(dependency)) continue;
    if (dependency === INTERFACE_PACKAGE && range === "workspace:^") continue;
    check(
      isString(range) && DMS_RANGE.test(range),
      `${field}["${dependency}"] is ${JSON.stringify(range)}: DMS packages are referenced by a ">=<floor> <1.0.0" range, a caret range on 0.0.x breaks interface resolution at startup.`,
    );
  }
}

if (expected.role === "runtime") {
  const interfaceRange = valueAt(pkg, "dependencies", INTERFACE_PACKAGE);
  const release = valueAt(pkg, "scripts", "release");
  const releaseScript = isString(release) ? release : "";
  check(
    interfaceRange === "workspace:^",
    `dependencies["${INTERFACE_PACKAGE}"] is ${JSON.stringify(interfaceRange)}: the module implements it, so it must name the sibling with "workspace:^", which pnpm pack writes as ^<interface version>.`,
  );
  check(
    !/\bnpm publish\b|\bpnpm publish\b/.test(releaseScript),
    'the release script publishes directly: releasing the module must not publish the interface package, use the "Release DMS automation interface" workflow.',
  );
  check(
    releaseScript.includes("verify:interface"),
    "the release script no longer runs verify:interface: the module must refuse to release before its interface is resolvable on npmjs.",
  );
}

if (failures.length > 0) {
  console.error(
    `${manifestPath} is not releasable:\n  ${failures.join("\n  ")}`,
  );
  process.exit(1);
}

console.log(
  `${String(pkgName)}@${String(pkgVersion)} (${packageDirectory}) is releasable.`,
);
