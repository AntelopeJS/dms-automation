const assert = require("node:assert/strict");
const {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

function writeShim(directory, name) {
  const filename = path.join(directory, name);
  writeFileSync(
    filename,
    `#!/usr/bin/env node
require("node:fs").appendFileSync(process.env.RELEASE_HARNESS_LOG, "${name} " + process.argv.slice(2).join(" ") + "\\n");
`,
  );
  chmodSync(filename, 0o755);
}

test("release runs module checks and verifies the public interface before release-it", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "automation-release-"));
  const log = path.join(directory, "calls.log");
  const root = path.resolve(__dirname, "..");
  try {
    writeShim(directory, "pnpm");
    writeShim(directory, "release-it");
    const release = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ).scripts.release;
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ scripts: { release } }),
    );
    const result = spawnSync(
      process.env.npm_execpath,
      ["--dir", directory, "release", "--ci"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          RELEASE_HARNESS_LOG: log,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [
      "pnpm --dir frontend-vue install --frozen-lockfile",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test:frontend-registration",
      "pnpm run verify:interface",
      "release-it --ci",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
