const fs = require("node:fs");
const path = require("node:path");

/**
 * Loads the frontend's sources through `require`, for the tests that render
 * its components on a server: TypeScript is transpiled to CommonJS, and
 * single-file components are compiled first (template inlined), with
 * `import.meta.env.SSR` true. Packages resolve from frontend-vue, as the
 * generated application resolves them.
 */

const FRONTEND = path.resolve(__dirname, "../../frontend-vue");
const {
  compileScript,
  parse,
} = require("../../frontend-vue/node_modules/vue/compiler-sfc");
const ts = require("../../frontend-vue/node_modules/typescript");

/**
 * @param {NodeJS.Module} module
 * @param {string} filename
 * @param {string} source
 */
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

/**
 * A component of `app/components`.
 * @param {string} file
 * @returns {unknown}
 */
const component = (file) =>
  require(path.join(FRONTEND, "app/components", file)).default;

module.exports = { FRONTEND, component };
