const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

// Registered trigger / action / data-node types may declare `name` and
// `description` as `$`-prefixed DMS i18n keys. These tests render the
// components that display them and check both forms: keys come out
// translated, plain strings come out as written.

const FRONTEND = path.resolve(__dirname, "../frontend-vue");
const frontendRequire = Module.createRequire(
  path.join(FRONTEND, "package.json"),
);
const vue = frontendRequire("vue");
const { compileScript, parse } = frontendRequire("vue/compiler-sfc");
const { renderToString } = frontendRequire("vue/server-renderer");
const ts = frontendRequire("typescript");

// Loads the frontend sources through `require`: TypeScript is transpiled to
// CommonJS, and single-file components are compiled first (template inlined).
function compileTypeScript(module, filename, source) {
  const { outputText } = ts.transpileModule(source, {
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

const component = (file) =>
  require(path.join(FRONTEND, "app/components", file)).default;

// Stand-in for the host's `processI18n`: `$` marks a key, anything else is
// returned verbatim (dms-core `resolveI18nKey`).
const MESSAGES = {
  "acme.trigger.name": "Déclencheur traduit",
  "acme.trigger.description": "Description traduite",
  "acme.action.name": "Action traduite",
  "acme.data.name": "Donnée traduite",
  "acme.data.description": "Donnée décrite",
};
function processI18n(value) {
  if (!value.startsWith("$")) return value;
  const key = value.slice(1);
  return MESSAGES[key] ?? key;
}

// Nuxt auto-imports the components below resolve at setup time.
globalThis.useTranslation = () => ({ processI18n });
globalThis.useToast = () => ({ add() {} });

const SlotStub = vue.defineComponent({
  inheritAttrs: false,
  setup:
    (_, { slots }) =>
    () =>
      vue.h("div", [slots.header?.(), slots.default?.()]),
});
const HOST_COMPONENTS = [
  "DmsCard",
  "UCard",
  "UBadge",
  "UButton",
  "UAlert",
  "UIcon",
  "UInput",
];

async function render(root, props, components = {}) {
  const app = vue.createSSRApp({ render: () => vue.h(root, props) });
  app.config.globalProperties.$t = (key) => key;
  app.config.warnHandler = () => {};
  for (const name of HOST_COMPONENTS) app.component(name, SlotStub);
  for (const [name, definition] of Object.entries(components))
    app.component(name, definition);
  return renderToString(app);
}

const keyedTrigger = {
  id: "acme.keyed",
  name: "$acme.trigger.name",
  description: "$acme.trigger.description",
};
const plainTrigger = {
  id: "acme.plain",
  name: "Plain trigger",
  description: "Plain description",
};

test("catalog list translates keyed type names and keeps plain ones", async () => {
  const html = await render(component("Catalog/TypeList.vue"), {
    types: [keyedTrigger, plainTrigger],
    modelValue: null,
  });

  assert.match(html, /Déclencheur traduit/);
  assert.match(html, /Description traduite/);
  assert.match(html, /Plain trigger/);
  assert.match(html, /Plain description/);
  assert.doesNotMatch(html, /acme\.trigger\./);
});

test("catalog config form header translates a keyed type", async () => {
  const TypeConfigForm = component("Catalog/TypeConfigForm.vue");
  const props = { savedConfig: "{}", savedEnabled: true };

  const keyed = await render(TypeConfigForm, { ...props, type: keyedTrigger });
  assert.match(keyed, /Déclencheur traduit/);
  assert.match(keyed, /Description traduite/);
  assert.doesNotMatch(keyed, /acme\.trigger\./);

  const plain = await render(TypeConfigForm, { ...props, type: plainTrigger });
  assert.match(plain, /Plain trigger/);
  assert.match(plain, /Plain description/);
});

test("builder palette labels translate keyed trigger, action and data-node types", async () => {
  const kind = (name, category, typeRegistry) => ({
    kind: name,
    meta: {
      continuationPorts: [],
      sidePorts: [],
      ui: { label: name, category, typeRegistry },
    },
  });
  const html = await render(component("Editor/BuilderPalette.vue"), {
    nodeKinds: [
      kind("trigger", "trigger", "triggers"),
      kind("action", "action", "actions"),
      kind("data", "data", "dataNodes"),
    ],
    triggerTypes: [keyedTrigger, plainTrigger],
    actionTypes: [{ id: "acme.action", name: "$acme.action.name" }],
    dataNodeTypes: [
      {
        id: "acme.data",
        category: "acme",
        name: "$acme.data.name",
        description: "",
      },
    ],
  });

  assert.match(html, /Déclencheur traduit/);
  assert.match(html, /Plain trigger/);
  assert.match(html, /Action traduite/);
  assert.match(html, /Donnée traduite/);
  assert.doesNotMatch(html, /acme\.(trigger|action|data)\.name/);
});

test("node inspector shows the translated type of the selected node", async () => {
  const NodeInspector = component("Editor/NodeInspector.vue");
  const props = {
    dataEdges: [],
    actionType: null,
    triggerTypes: [keyedTrigger, plainTrigger],
    actionTypes: [],
    dataNodeTypes: [],
    nodeKinds: [],
  };
  const node = (typeId) => ({ id: "n1", kind: "trigger", typeId, config: {} });

  const keyed = await render(NodeInspector, {
    ...props,
    node: node(keyedTrigger.id),
    triggerType: keyedTrigger,
  });
  assert.match(keyed, /Déclencheur traduit/);
  assert.doesNotMatch(keyed, /acme\.trigger\.name/);

  const plain = await render(NodeInspector, {
    ...props,
    node: node(plainTrigger.id),
    triggerType: plainTrigger,
  });
  assert.match(plain, /Plain trigger/);
});

test("data-node catalog detail translates the selected type", async () => {
  globalThis.useAuthFetch = () => ({
    $authFetch: async () => [
      {
        id: "acme.data",
        category: "acme",
        name: "$acme.data.name",
        description: "$acme.data.description",
        icon: "",
      },
    ],
  });
  const html = await render(
    {
      render: () =>
        vue.h(vue.Suspense, null, {
          default: () => vue.h(component("DataNodes.vue")),
        }),
    },
    {},
    { DmsAutomationTypeList: component("Catalog/TypeList.vue") },
  );

  assert.match(html, /Donnée traduite/);
  assert.match(html, /Donnée décrite/);
  assert.doesNotMatch(html, /acme\.data\./);
});
