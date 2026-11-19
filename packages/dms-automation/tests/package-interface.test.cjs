const nodeChild = require("node:child_process");
const nodeFs = require("node:fs");
const nodeOs = require("node:os");
const nodePath = require("node:path");
const { test } = require("node:test");
const { check, same, assertChecks } = require("./helpers/checks.cjs");
const {
  INTERFACE,
  MODULE,
  ROOT,
  codeBlocks,
  read,
} = require("./helpers/package-files.cjs");

const skill = read(`${INTERFACE}/skills/dms-automation-interface/SKILL.md`);
const declarations = read(`${INTERFACE}/dist/index.d.ts`);

void test("interface skill imports: fails on an import the interface does not export or an exported function left out", async (t) => {
  const imports = (
    /import \{([\s\S]*?)\} from "@antelopejs\/interface-dms-automation"/.exec(
      skill,
    )?.[1] ?? ""
  )
    .split(",")
    .map((entry) => entry.replace(/type /, "").trim())
    .filter(Boolean);
  const exported = new Set(
    [
      ...declarations.matchAll(
        /export (?:declare )?(?:const|function|interface|type|class) (\w+)/g,
      ),
    ].map((match) => match[1]),
  );
  await assertChecks(t, "the skill's import list", [
    check(
      "it lists the functions and types",
      imports.length >= 24,
      imports.length,
    ),
    same(
      "each one is exported",
      imports.filter((name) => !exported.has(name)),
      [],
    ),
    same(
      "every exported function is listed",
      [
        ...declarations.matchAll(
          /export (?:declare )?(?:const|function) (\w+)/g,
        ),
      ]
        .map((match) => match[1])
        .filter(
          (name) =>
            /^(Register|Unregister|List|Invoke|Run|Declare)/.test(name) &&
            !imports.includes(name),
        ),
      [],
    ),
  ]);
});

void test("single entry point: fails on a subpath export or a skill and docs that stop saying so", async (t) => {
  const resolved = nodeChild.spawnSync(
    process.execPath,
    [
      "-e",
      'try { require.resolve("@antelopejs/interface-dms-automation/does-not-exist"); console.log("resolved"); } catch (e) { console.log(e.code); }',
    ],
    { cwd: nodePath.join(ROOT, MODULE), encoding: "utf8" },
  );
  await assertChecks(t, "single entry point", [
    check(
      "the skill says so",
      /Single entry point only/.test(skill),
      skill.length,
    ),
    same(
      "another subpath does not resolve",
      resolved.stdout.trim(),
      "MODULE_NOT_FOUND",
    ),
    check(
      "the docs say the internal namespace is not a consumer entry point",
      /The `internal` proxy namespace is not a supported consumer entry point/.test(
        read(`${INTERFACE}/docs/1.index.md`),
      ),
      0,
    ),
  ]);
});

void test("docs code blocks: fails on a TypeScript block that no longer compiles against the interface", async (t) => {
  const folder = nodeFs.mkdtempSync(
    nodePath.join(nodeOs.tmpdir(), "docs-code-blocks-"),
  );
  t.after(() => nodeFs.rmSync(folder, { recursive: true, force: true }));
  /** @type {string[]} */
  const names = [];
  const sources = [
    `${MODULE}/docs/5.extending.md`,
    `${INTERFACE}/docs/1.index.md`,
    `${INTERFACE}/README.md`,
    `${MODULE}/README.md`,
  ];
  for (const source of sources) {
    let index = 0;
    for (const block of codeBlocks(read(source))) {
      index += 1;
      if (
        !["ts", "typescript"].includes(block.language) ||
        /fragment/.test(block.info)
      )
        continue;
      const file = `${source.replace(/[^\w]+/g, "_")}_${index}.ts`;
      nodeFs.writeFileSync(
        nodePath.join(folder, file),
        /^(import|export) /m.test(block.body)
          ? block.body
          : `${block.body}\nexport {};\n`,
      );
      names.push(file);
    }
  }
  nodeFs.writeFileSync(
    nodePath.join(folder, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "esnext",
        moduleResolution: "bundler",
        target: "es2022",
        skipLibCheck: true,
        typeRoots: [nodePath.join(ROOT, INTERFACE, "node_modules", "@types")],
        types: ["node"],
        paths: {
          "@antelopejs/interface-dms-automation": [
            nodePath.join(ROOT, INTERFACE, "dist", "index.d.ts"),
          ],
        },
      },
      include: ["*.ts"],
    }),
  );
  const compiled = nodeChild.spawnSync(
    process.execPath,
    [
      nodePath.join(ROOT, MODULE, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      nodePath.join(folder, "tsconfig.json"),
    ],
    { encoding: "utf8" },
  );
  const errors = compiled.stdout
    .split("\n")
    .filter((line) => /error TS/.test(line));
  await assertChecks(t, "the docs' TypeScript blocks compile", [
    check("there are blocks to compile", names.length >= 14, names.length),
    same("no type error", errors, []),
  ]);
});
