// Release gate shared by both callers: a package is only allowed to reach npm
// if its manifest still says what this repository promised to publish. One
// assertion per rule, all of them reported at once, each naming the fix.
//
//   node .github/scripts/validate-release-metadata.mjs packages/dms-automation
import fs from "node:fs";
import path from "node:path";

const REPOSITORY_URL = "git+https://github.com/AntelopeJS/dms-automation.git";
const INTERFACE_PACKAGE = "@antelopejs/interface-dms-automation";

// The publication target of this repository, in one place. A release from a
// directory that is not listed here is a mistake, not a new package.
const PACKAGES = {
  "packages/dms-automation": {
    name: "@antelopejs/dms-automation",
    role: "runtime",
  },
  "packages/interface-dms-automation": {
    name: INTERFACE_PACKAGE,
    role: "interface",
  },
};

const [packageDirectory] = process.argv.slice(2);
if (packageDirectory === undefined) {
  throw new Error(
    `Usage: node ${path.relative(process.cwd(), process.argv[1])} <package-directory>`,
  );
}

const expected = PACKAGES[packageDirectory];
if (expected === undefined) {
  throw new Error(
    `${packageDirectory} is not a publishable package of this repository. Expected one of: ${Object.keys(PACKAGES).join(", ")}.`,
  );
}

const manifestPath = path.join(packageDirectory, "package.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error(
    `${manifestPath} does not exist: the release would publish nothing.`,
  );
}
const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

check(
  pkg.name === expected.name,
  `name is ${JSON.stringify(pkg.name)}: ${packageDirectory} publishes ${expected.name}.`,
);
check(
  pkg.private !== true,
  "private is true: remove it, a private package cannot be published.",
);
check(
  pkg.license === "Apache-2.0",
  `license is ${JSON.stringify(pkg.license)}: every package of this repository ships under Apache-2.0.`,
);
check(
  pkg.repository?.url === REPOSITORY_URL,
  `repository.url is ${JSON.stringify(pkg.repository?.url)}: set it to ${REPOSITORY_URL} so provenance points at this repository.`,
);
check(
  pkg.publishConfig?.registry === "https://registry.npmjs.org/",
  `publishConfig.registry is ${JSON.stringify(pkg.publishConfig?.registry)}: this package is public, publish it to https://registry.npmjs.org/.`,
);
check(
  pkg.publishConfig?.access === "public",
  `publishConfig.access is ${JSON.stringify(pkg.publishConfig?.access)}: a scoped package defaults to restricted, set it to "public".`,
);
check(
  pkg.publishConfig?.provenance === true,
  "publishConfig.provenance is not true: the shared workflow publishes with npm OIDC and needs provenance enabled.",
);

// `@antelopejs/core` resolves interface packages by range: a caret range on a
// 0.0.x version (`^0.0.1` means `>=0.0.1 <0.0.2`) stops satisfying the
// canonical installed version on the first patch release and the host refuses
// to boot with "Incompatible interface package resolution". Every DMS package
// is therefore referenced by an explicit `>=<floor> <1.0.0` range; pnpm links
// the sibling inside the workspace through `link-workspace-packages`.
const DMS_PACKAGE =
  /^@antelopejs\/(dms|dms-.+|interface-dms|interface-dms-.+)$/;
const DMS_RANGE = /^>=\d+\.\d+\.\d+ <\d+\.\d+\.\d+$/;

// The fleet shape is `>=<floor> <1.0.0`: the ceiling is out of reach for a 0.x
// package, so comparing the release triples against the floor is enough.
function compareVersions(a, b) {
  const parts = (version) => version.split("-")[0].split(".").map(Number);
  const [x, y] = [parts(a), parts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

function satisfiesFleetRange(version, range) {
  const floor = /^>=(\d+\.\d+\.\d+) <1\.0\.0$/.exec(range ?? "")?.[1];
  return floor !== undefined && compareVersions(version, floor) >= 0;
}
for (const field of [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]) {
  for (const [dependency, range] of Object.entries(pkg[field] ?? {})) {
    if (!DMS_PACKAGE.test(dependency)) continue;
    check(
      DMS_RANGE.test(range),
      `${field}["${dependency}"] is ${JSON.stringify(range)}: DMS packages are referenced by a ">=<floor> <1.0.0" range, a caret range on 0.0.x breaks interface resolution at startup.`,
    );
  }
}

if (expected.role === "runtime") {
  // The interface sitting next to the module only has to SATISFY the range the
  // module publishes. A floor that lags it widens what consumers may install
  // without ever pulling a second copy, so an interface release must not block
  // the module's release.
  const interfaceVersion = JSON.parse(
    fs.readFileSync(
      path.join("packages", "interface-dms-automation", "package.json"),
      "utf8",
    ),
  ).version;
  const interfaceRange = pkg.dependencies?.[INTERFACE_PACKAGE];
  check(
    satisfiesFleetRange(interfaceVersion, interfaceRange),
    `dependencies["${INTERFACE_PACKAGE}"] is ${JSON.stringify(interfaceRange)}: it must be a ">=<floor> <1.0.0" range satisfied by the interface in this tree (${interfaceVersion}).`,
  );
  // Releasing the module must never push the interface: they carry separate
  // versions, separate tags and separate workflows.
  check(
    !/\bnpm publish\b|\bpnpm publish\b/.test(pkg.scripts?.release ?? ""),
    'the release script publishes directly: releasing the module must not publish the interface package, use the "Release DMS automation interface" workflow.',
  );
  check(
    (pkg.scripts?.release ?? "").includes("verify:interface"),
    "the release script no longer runs verify:interface: the module must refuse to release before its interface is resolvable on npmjs.",
  );
}

if (failures.length > 0) {
  console.error(
    `${manifestPath} is not releasable:\n  ${failures.join("\n  ")}`,
  );
  process.exit(1);
}

console.log(`${pkg.name}@${pkg.version} (${packageDirectory}) is releasable.`);
