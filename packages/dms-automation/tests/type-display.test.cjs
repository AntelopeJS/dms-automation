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
// `te` finds no key: components fall back to the text they were given.
globalThis.useI18n = () => ({
  t: (key) => key,
  te: () => false,
  locale: { value: "en" },
});
globalThis.useToast = () => ({ add() {} });
globalThis.useRegionalFormat = () => ({
  dateTimeFormat: (options) => new Intl.DateTimeFormat("en", options),
});

const SlotStub = vue.defineComponent({
  inheritAttrs: false,
  setup:
    (_, { slots }) =>
    () =>
      vue.h("div", [slots.header?.(), slots.default?.()]),
});
const HOST_COMPONENTS = [
  "UTabs",
  "USwitch",
  "USelect",
  "UTextarea",
  "UTooltip",
  "DmsStatusPill",
  "DmsAutomationSchemaTable",
  "DmsAutomationWiredField",
  "DmsAutomationGroupPortEditor",
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

test("describe helpers translate keyed trigger names and word schedules", () => {
  const { describeTrigger, describeCron, stepTitle, summarizeNode } = require(
    path.join(FRONTEND, "app/utils/describe.ts"),
  );
  const t = (key, params = {}) =>
    key.startsWith("$")
      ? `${key.slice(1)}${Object.keys(params).length ? JSON.stringify(params) : ""}`
      : key;

  assert.equal(
    describeTrigger(
      { typeId: "acme.keyed", typeName: "$acme.trigger.name" },
      processI18n,
    ),
    "Déclencheur traduit",
  );
  assert.equal(
    describeTrigger(
      {
        typeId: "webhook",
        typeName: "Webhook",
        path: "/hooks/a",
        method: "PUT",
      },
      t,
    ),
    "PUT /hooks/a",
  );
  assert.equal(
    describeCron("*/15 * * * *", t),
    'dms_automation.cron.everyMinutes{"n":"15"}',
  );
  assert.equal(
    describeCron("0 2 * * *", t),
    'dms_automation.cron.daily{"time":"02:00"}',
  );
  assert.match(describeCron("0 9 * * 1", t), /^dms_automation\.cron\.weekly/);
  assert.equal(describeCron("0 9 1-3 * 1", t), "0 9 1-3 * 1");
  assert.equal(
    stepTitle({ nodeId: "n", typeName: "$acme.action.name" }, processI18n),
    "Action traduite",
  );
  assert.equal(
    stepTitle({ nodeId: "n", label: "Push", typeName: "x" }, processI18n),
    "Push",
  );
  assert.equal(
    summarizeNode(
      "action",
      "http.request",
      { url: "https://erp.acme.io/api/invoices", method: "POST" },
      t,
    ),
    "POST erp.acme.io/api/invoices",
  );
});

test("schema tables show item types, nested fields, one-of rules and inline code", async () => {
  const html = await render(component("Catalog/SchemaTable.vue"), {
    schema: {
      type: "object",
      properties: {
        userIds: { type: "array", items: { type: "string" } },
        roleIds: { type: "array", items: { type: "string" } },
        options: {
          type: "object",
          properties: { retries: { type: "number" } },
        },
        cron: { type: "string", description: "e.g. `*/5 * * * *`" },
      },
      anyOf: [{ required: ["userIds"] }, { required: ["roleIds"] }],
    },
  });
  assert.match(html, /string\[\]/);
  assert.match(html, /options\.retries/);
  assert.match(html, /<code[^>]*>\*\/5 \* \* \* \*<\/code>/);
  assert.match(html, /dms_automation\.library\.schemaOneOf/);
});

test("schema tables drop the description column when no field has one", async () => {
  const html = await render(component("Catalog/SchemaTable.vue"), {
    schema: { properties: { ok: { type: "boolean" } } },
  });
  assert.doesNotMatch(html, /library\.schema\.description/);
});

test("a webhook endpoint offers no URL to copy until the server's address is known", async () => {
  globalThis.useAuthFetch = () => ({ $authFetch: () => new Promise(() => {}) });
  const CopyButton = vue.defineComponent({
    props: { value: String },
    setup: (props) => () => vue.h("button", { "data-copy": props.value }),
  });
  const compact = await render(
    component("WebhookEndpoint.vue"),
    { path: "/webhooks/orders", compact: true },
    { DmsCopyButton: CopyButton },
  );
  assert.match(compact, /POST \/webhooks\/orders/);
  assert.doesNotMatch(compact, /data-copy/);
  const full = await render(
    component("WebhookEndpoint.vue"),
    { path: "/webhooks/orders" },
    {
      DmsCopyButton: CopyButton,
      USkeleton: vue.defineComponent({
        setup: () => () => vue.h("i", "loading"),
      }),
    },
  );
  assert.match(full, /loading/);
  assert.doesNotMatch(full, /data-copy|curl/);
});

test("dates are written through the page's regional format", () => {
  const { describeDateTime, describeTime } = require(
    path.join(FRONTEND, "app/utils/describe.ts"),
  );
  // As `useRegionalFormat().dateTimeFormat` does for a user who set a time
  // zone and a 12-hour clock: their settings, unless the text names a zone.
  const regional = (options) =>
    new Intl.DateTimeFormat("en-GB", {
      ...options,
      timeZone: options.timeZone ?? "America/New_York",
      hourCycle: "h12",
    });
  const date = new Date(Date.UTC(2020, 9, 12, 17, 57));
  assert.equal(describeDateTime(date, regional), "12 Oct 2020, 1:57 pm");
  assert.equal(
    describeDateTime(date, regional, "Europe/Paris"),
    "12 Oct 2020, 7:57 pm",
  );
  assert.equal(describeTime("not a date", regional), "—");
  assert.equal(describeDateTime(null, regional), "—");
});
