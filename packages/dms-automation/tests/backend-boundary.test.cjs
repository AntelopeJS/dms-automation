const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { frontendRequire } = require("./frontend.cjs");

const {
  backendBoundary,
} = require("../frontend-vue/build/backend-boundary.ts");
const vite = frontendRequire("vite");

/** A scratch repository: the backend package, another package, and the frontend module inside the backend package. */
let repository;
let frontend;

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

before(() => {
  repository = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dms-automation-boundary-")),
  );
  const backend = path.join(repository, "packages/dms-automation");
  frontend = path.join(backend, "frontend-vue");
  write(
    path.join(backend, "package.json"),
    JSON.stringify({ name: "@antelopejs/dms-automation" }),
  );
  write(path.join(backend, "src/backend.ts"), "export const secret = 1;\n");
  write(path.join(backend, "dist/built.js"), "export const built = 2;\n");
  write(
    path.join(repository, "packages/other/package.json"),
    JSON.stringify({ name: "other" }),
  );
  write(
    path.join(repository, "packages/other/src/shared.ts"),
    "export const shared = 3;\n",
  );
  fs.mkdirSync(frontend, { recursive: true });
  fs.symlinkSync(
    path.join(backend, "src/backend.ts"),
    path.join(frontend, "linked.ts"),
  );
});

after(() => {
  fs.rmSync(repository, { recursive: true, force: true });
});

/** Builds a frontend entry made of `source`, with the boundary plugin and `extra` plugins. */
async function build(
  source,
  { extra = [], alias = {}, preserveSymlinks = false } = {},
) {
  write(path.join(frontend, "entry.ts"), source);
  const result = await vite.build({
    root: frontend,
    configFile: false,
    logLevel: "silent",
    plugins: [backendBoundary(), ...extra],
    resolve: { alias, preserveSymlinks },
    build: {
      write: false,
      lib: { entry: path.join(frontend, "entry.ts"), formats: ["es"] },
    },
  });
  return result;
}

/** A plugin that answers the import `request` with the module id `id`. */
function resolver(request, id) {
  return {
    name: "test-resolver",
    resolveId: (source) => (source === request ? { id } : null),
    load: (loaded) =>
      loaded === id || loaded.startsWith("\0") ? "export default 1;\n" : null,
  };
}

test("an import of the backend source fails the build, naming both files", async () => {
  await assert.rejects(
    build('import { secret } from "../src/backend.ts";\nexport { secret };\n'),
    (error) => {
      assert.match(error.message, /Backend boundary/);
      assert.ok(error.message.includes(path.join(frontend, "entry.ts")));
      assert.ok(
        error.message.includes(
          path.join(repository, "packages/dms-automation/src/backend.ts"),
        ),
      );
      return true;
    },
  );
});

test("an alias that points into the backend source fails the build", async () => {
  await assert.rejects(
    build(
      'import { secret } from "@backend/backend.ts";\nexport { secret };\n',
      {
        alias: {
          "@backend": path.join(repository, "packages/dms-automation/src"),
        },
      },
    ),
    /Backend boundary/,
  );
});

test("a symlink to the backend source, followed by the resolver, fails the build", async () => {
  await assert.rejects(
    build('import { secret } from "./linked.ts";\nexport { secret };\n', {
      extra: [resolver("./linked.ts", path.join(frontend, "linked.ts"))],
      preserveSymlinks: true,
    }),
    /Backend boundary/,
  );
});

test("an id with a query or a hash still names the backend source", async () => {
  const target = path.join(
    repository,
    "packages/dms-automation/src/backend.ts",
  );
  for (const suffix of ["?raw", "#fragment"]) {
    await assert.rejects(
      build('import secret from "virtual-backend";\nexport { secret };\n', {
        extra: [resolver("virtual-backend", `${target}${suffix}`)],
      }),
      /Backend boundary/,
      suffix,
    );
  }
});

test("the built output, a virtual module and the source of another package pass", async () => {
  const built = await build(
    'import { built } from "../dist/built.js";\nexport { built };\n',
  );
  assert.match(JSON.stringify(built), /built/);
  const virtual = await build(
    'import value from "virtual:thing";\nexport { value };\n',
    { extra: [resolver("virtual:thing", "\0virtual:thing")] },
  );
  assert.match(JSON.stringify(virtual), /value/);
  const other = await build(
    'import { shared } from "../../other/src/shared.ts";\nexport { shared };\n',
  );
  assert.match(JSON.stringify(other), /shared/);
});
