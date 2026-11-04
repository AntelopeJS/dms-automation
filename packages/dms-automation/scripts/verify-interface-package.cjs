const { spawnSync } = require("node:child_process");
const pkg = require("../../interface-dms-automation/package.json");
const registry = "https://registry.npmjs.org/";
const result = spawnSync(
  "npm",
  ["view", `${pkg.name}@${pkg.version}`, "version", `--registry=${registry}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);

if (result.status !== 0 || result.stdout.trim() !== pkg.version) {
  console.error(
    `${pkg.name}@${pkg.version} is not resolvable from ${registry}; publish it separately before releasing the module.`,
  );
  process.exit(result.status || 1);
}
