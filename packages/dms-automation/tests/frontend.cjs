const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

// Loads the frontend's sources through `require`, for the tests that render
// its components on a server: TypeScript is transpiled to CommonJS, and
// single-file components are compiled first (template inlined), with
// `import.meta.env.SSR` true. Packages resolve from frontend-vue, as the
// generated application resolves them.

const FRONTEND = path.resolve(__dirname, "../frontend-vue");
const frontendRequire = Module.createRequire(
  path.join(FRONTEND, "package.json"),
);
const { compileScript, parse } = frontendRequire("vue/compiler-sfc");
const ts = frontendRequire("typescript");

function compileTypeScript(module, filename, source) {
  const server = source.replaceAll("import.meta.env", "({ SSR: true })");
  const { outputText } = ts.transpileModule(server, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  module._compile(outputText, filename);
}
require.extensions[".ts"] = (module, filename) =>
  compileTypeScript(module, filename, fs.readFileSync(filename, "utf8"));
require.extensions[".vue"] = (module, filename) => {
  const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
  const { content } = compileScript(descriptor, {
    id: path.relative(FRONTEND, filename),
    inlineTemplate: true,
  });
  compileTypeScript(module, filename, content);
};

/** A component of `app/components`. */
const component = (file) =>
  require(path.join(FRONTEND, "app/components", file)).default;

// The key the renderer hands a request's response over under: a digest of
// its method, base URL, URL, query and body (the renderer's `requestKey`).
const HASH_SEEDS = [0xdeadbeef, 0x41c6ce57];
const HASH_MULTIPLIERS = [2654435761, 1597334677];
const HASH_FINALIZERS = [2246822507, 3266489909];
const HASH_SHIFTS = [16, 13];
const HASH_RADIX = 36;
const HASH_LANE_LENGTH = 7;

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const members = Object.keys(value)
    .filter((name) => value[name] !== undefined)
    .sort()
    .map((name) => `${JSON.stringify(name)}:${stableJson(value[name])}`);
  return `{${members.join(",")}}`;
}

function hashText(text) {
  let [first, second] = HASH_SEEDS;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, HASH_MULTIPLIERS[0]);
    second = Math.imul(second ^ code, HASH_MULTIPLIERS[1]);
  }
  first = Math.imul(first ^ (first >>> HASH_SHIFTS[0]), HASH_FINALIZERS[0]);
  first ^= Math.imul(second ^ (second >>> HASH_SHIFTS[1]), HASH_FINALIZERS[1]);
  second = Math.imul(second ^ (second >>> HASH_SHIFTS[0]), HASH_FINALIZERS[0]);
  second ^= Math.imul(first ^ (first >>> HASH_SHIFTS[1]), HASH_FINALIZERS[1]);
  return [second, first]
    .map((lane) =>
      (lane >>> 0).toString(HASH_RADIX).padStart(HASH_LANE_LENGTH, "0"),
    )
    .join("");
}

/** The key the payload carries the response of `read` under. */
const fetchKey = (read) =>
  `$dmsfetch:${hashText(
    stableJson([read.method, "", read.url, read.rawQuery ?? null, null]),
  )}`;

module.exports = { FRONTEND, frontendRequire, component, fetchKey };
