const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { compileScript, parse } = require("vue/compiler-sfc");
const ts = require("typescript");

/** Loads setup bindings so tests can submit the component's forms. */
function componentSetup(file, props) {
  const filename = path.resolve(__dirname, "../../app/components", file);
  const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
  const { content } = compileScript(descriptor, { id: file });
  const { outputText } = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(outputText, filename);
  return loaded.exports.default.setup(props, { expose() {}, emit() {} });
}

module.exports = { componentSetup };
