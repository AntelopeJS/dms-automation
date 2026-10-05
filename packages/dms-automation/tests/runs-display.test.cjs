const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { mock, test } = require("node:test");

// The Runs page lists its history through the module's own TableView display.
// The DMS reserves the built-in display ids and names module displays
// `<module>:<id>`, so the page and the frontend plugin must agree on that id,
// and the plugin must run on the server too.

const FRONTEND = path.resolve(__dirname, "../frontend-vue");
const TIMELINE_DISPLAY_ID = "automation:timeline";
const ts = Module.createRequire(path.join(FRONTEND, "package.json"))(
  "typescript",
);

// Loads `dms.frontend.ts` through `require`: TypeScript is transpiled to
// CommonJS, Vite's `import.meta.glob` finds no component, and the host
// virtual modules and single-file components are stubbed.
function loadFrontendModule() {
  const extension = require.extensions[".ts"];
  require.extensions[".ts"] = (module, filename) => {
    const source = fs
      .readFileSync(filename, "utf8")
      .replace(/import\.meta\.glob(<[^>]*>)?\([^)]*\)/g, "({})");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
    });
    module._compile(outputText, filename);
  };
  const load = Module._load;
  mock.method(Module, "_load", (name, parent, isMain) => {
    if (name === "#dms/frontend-module")
      return { defineDmsPlugin: (plugin) => plugin };
    if (name.endsWith(".vue")) return { default: { name } };
    return load(name, parent, isMain);
  });
  try {
    return require(path.join(FRONTEND, "dms.frontend.ts")).default;
  } finally {
    mock.restoreAll();
    require.extensions[".ts"] = extension;
  }
}

test("the runs page offers the namespaced timeline display by default", () => {
  const { RunsPageController } = require("../dist/pages/runs.js");
  const options = RunsPageController.table._options;

  assert.deepEqual(
    options.displays.map((display) => display.id),
    [TIMELINE_DISPLAY_ID],
  );
  assert.equal(options.defaultDisplay, TIMELINE_DISPLAY_ID);
});

test("the frontend registers the timeline display from a universal plugin", async () => {
  const plugins = [];
  loadFrontendModule().setup({
    registerComponent() {},
    registerPlugin: (plugin, options) => plugins.push({ plugin, options }),
  });

  assert.equal(plugins.length, 1);
  assert.equal(plugins[0].options?.clientOnly, undefined);

  const displays = [];
  globalThis.registerTableViewDisplay = (display) => displays.push(display);
  try {
    await plugins[0].plugin();
  } finally {
    delete globalThis.registerTableViewDisplay;
  }

  assert.deepEqual(
    displays.map((display) => display.id),
    [TIMELINE_DISPLAY_ID],
  );
  assert.equal(
    displays[0].component.name,
    "../components/RunsTimelineDisplay.vue",
  );
});
