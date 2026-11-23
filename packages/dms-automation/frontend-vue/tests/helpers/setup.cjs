const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { compileScript, parse } = require("vue/compiler-sfc");
const ts = require("typescript");
const { FRONTEND } = require("../../../tests/helpers/frontend.cjs");

/** @typedef {ReturnType<typeof import("../../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useApiErrorPresenter").useApiErrorPresenter>} ApiErrorPresenter */

/**
 * @param {unknown} value
 * @returns {value is (from: string) => string[]} Whether the value is the lookup of a directory's module paths.
 */
function isPathsOf(value) {
  return value instanceof Function;
}

/** @type {unknown} */
const privatePaths = Module._nodeModulePaths;
if (!isPathsOf(privatePaths))
  throw new Error("Module._nodeModulePaths is not available in this Node");
const nodeModulePaths = privatePaths;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>} Whether the value is an object.
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * @param {unknown} value
 * @returns {value is (props: Record<string, unknown>, context: { expose: () => void; emit: () => void }) => unknown} Whether the value is a component's setup.
 */
function isSetup(value) {
  return value instanceof Function;
}

/**
 * @param {string} filename
 * @param {string} source
 * @returns {unknown} The exports of the compiled module.
 */
function evaluate(filename, source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = nodeModulePaths(path.dirname(filename));
  loaded._compile(outputText, filename);
  return loaded.exports;
}

/**
 * Loads a composable with browser-side presentation enabled.
 * @template T
 * @param {string} filename
 * @param {(exported: unknown) => exported is T} isExports
 * @returns {T} The exports, as `isExports` vouches for them.
 */
function clientComposable(filename, isExports) {
  const exported = evaluate(
    filename,
    fs
      .readFileSync(filename, "utf8")
      .replaceAll("import.meta.env", "({ SSR: false })"),
  );
  if (!isExports(exported))
    throw new Error(`${filename} does not export what the test reads`);
  return exported;
}

/**
 * Loads setup bindings so tests can submit the component's forms.
 * @template T
 * @param {string} file
 * @param {Record<string, unknown>} props
 * @param {(bindings: unknown) => bindings is T} isBindings
 * @returns {T} The setup bindings, as `isBindings` vouches for them.
 */
function componentSetup(file, props, isBindings) {
  const filename = path.resolve(__dirname, "../../app/components", file);
  const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
  const { content } = compileScript(descriptor, { id: file });
  const exported = evaluate(filename, content);
  if (
    !isRecord(exported) ||
    !isRecord(exported.default) ||
    !isSetup(exported.default.setup)
  )
    throw new Error(`${file} does not export a component with a setup`);
  const bindings = exported.default.setup(props, {
    expose() {},
    emit() {},
  });
  if (!isBindings(bindings))
    throw new Error(`${file} does not set up what the test reads`);
  return bindings;
}

/** @returns {() => ApiErrorPresenter} The composable, loaded for the browser. */
function clientApiErrorPresenter() {
  const { useApiErrorPresenter } = clientComposable(
    path.join(
      FRONTEND,
      "node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useApiErrorPresenter.ts",
    ),
    /**
     * @param {unknown} exported
     * @returns {exported is { useApiErrorPresenter: () => ApiErrorPresenter }} Whether the module exports the composable.
     */
    (exported) =>
      isRecord(exported) && exported.useApiErrorPresenter instanceof Function,
  );
  return useApiErrorPresenter;
}

module.exports = { componentSetup, clientApiErrorPresenter, isRecord };
