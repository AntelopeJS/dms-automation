const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("../frontend-vue/node_modules/typescript");

/**
 * The tests load dms-frontend's frontend runtime from its `templates/vue`
 * sources, which the package authors for bundler resolution (extensionless
 * relative imports). The tests' own compiler options must resolve those
 * sources the same way: under any other resolution the barrel's re-exports
 * fall out of the program and every member of the module becomes an
 * `error` typed value for the type-aware lint.
 */

const SERVER_RENDER = path.join(__dirname, "server-render.cjs");
const CONFIG = path.join(__dirname, "tsconfig.json");

/**
 * The checker and the source of `server-render.cjs`, in a program built from
 * the tests' tsconfig.
 */
function programOfServerRender() {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    CONFIG,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        );
      },
    },
  );
  assert.ok(parsed, "the tests' tsconfig parses");
  const program = ts.createProgram({
    rootNames: [SERVER_RENDER],
    options: parsed.options,
  });
  const source = program.getSourceFile(SERVER_RENDER);
  assert.ok(source, "server-render.cjs is part of the program");
  return { checker: program.getTypeChecker(), source };
}

void test("the frontend runtime the render tests load is typed under the tests' compiler options", () => {
  const { checker, source } = programOfServerRender();
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (candidate) =>
        ts.isIdentifier(candidate.name) && candidate.name.text === "engine",
    );
  assert.ok(declaration, "server-render.cjs declares `engine`");
  const member = checker
    .getTypeAtLocation(declaration.name)
    .getProperty("dmsRequestKey");
  assert.ok(member, "the module's type has `dmsRequestKey`");
  const signatures = checker
    .getTypeOfSymbolAtLocation(member, declaration)
    .getCallSignatures();
  assert.equal(signatures.length, 1);
  assert.equal(
    checker.typeToString(checker.getReturnTypeOfSignature(signatures[0])),
    "string | undefined",
  );
});
