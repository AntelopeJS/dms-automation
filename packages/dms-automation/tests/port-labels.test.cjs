const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");
const { FRONTEND, frontendRequire, component } = require("./frontend.cjs");

// A node's data ports read as their field's title on the canvas (a `$` key
// translated, plain text as written), and as the key when no title is
// declared. The key stays the handle id, since edges wire by it, and the
// label's hover text when the title hides it.

const vue = frontendRequire("vue");
const { renderToString } = frontendRequire("vue/server-renderer");
const { portLabel } = require(path.join(FRONTEND, "app/utils/describe.ts"));

const MESSAGES = {
  "acme.fields.userId": "Utilisateur",
  "acme.fields.tenantId": "Organisation",
};
function processI18n(value) {
  if (!value.startsWith("$")) return value;
  const key = value.slice(1);
  return MESSAGES[key] ?? key;
}

// Vue Flow's handles need a flow around them; a bare element carrying the
// handle id stands in for them.
const Handle = vue.defineComponent({
  props: { id: String },
  setup: (props) => () => vue.h("i", { "data-handleid": props.id }),
});
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "@vue-flow/core")
    return { Handle, Position: { Left: "left", Right: "right" } };
  return load.call(this, request, ...rest);
};

globalThis.useTranslation = () => ({ processI18n });
globalThis.useI18n = () => ({ t: (key) => key, te: () => false });

async function renderNode(data) {
  const app = vue.createSSRApp({
    render: () =>
      vue.h(component("Editor/nodes/GenericNode.vue"), { id: "n1", data }),
  });
  app.config.warnHandler = () => {};
  app.component("UIcon", vue.defineComponent({ setup: () => () => null }));
  return renderToString(app);
}

test("portLabel prefers the field's title and falls back to its key", () => {
  assert.equal(
    portLabel({ name: "userId", title: "$acme.fields.userId" }, processI18n),
    "Utilisateur",
  );
  assert.equal(
    portLabel({ name: "amount", title: "Amount due" }, processI18n),
    "Amount due",
  );
  assert.equal(portLabel({ name: "userId" }, processI18n), "userId");
  assert.equal(
    portLabel({ name: "userId", title: "  " }, processI18n),
    "userId",
  );
});

test("node ports read as translated titles and keep wiring by key", async () => {
  const html = await renderNode({
    label: "Member joined",
    dataIns: [{ name: "userId", title: "$acme.fields.userId" }],
    dataOuts: [
      { name: "tenantId", title: "$acme.fields.tenantId" },
      { name: "count", type: "number" },
    ],
  });

  assert.match(html, /<span title="userId">Utilisateur<\/span>/);
  assert.match(html, /<span title="tenantId">Organisation<\/span>/);
  // No title: the key is the label, with no redundant hover text.
  assert.match(html, /<span>count<\/span>/);
  assert.doesNotMatch(html, /acme\.fields/);
  // Handles keep the keys edges are stored with.
  assert.match(html, /data-handleid="data-in-userId"/);
  assert.match(html, /data-handleid="data-out-tenantId"/);
  assert.match(html, /data-handleid="data-out-count"/);
});
