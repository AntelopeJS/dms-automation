const assert = require("node:assert/strict");
const nodeChild = require("node:child_process");
const nodePath = require("node:path");
const { test } = require("node:test");
const { ROOT } = require("./helpers/package-files.cjs");

void test("dms-control map: fails on an uncovered file, a feature without journeys or docs, or a glob matching no file", () => {
  const result = nodeChild.spawnSync(
    nodePath.join(ROOT, "node_modules", ".bin", "dms-control"),
    ["map"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  assert.equal(
    result.status,
    0,
    `dms-control map exited ${String(result.status)}\n${result.stdout}${result.stderr}${result.error?.message ?? ""}`,
  );
});
