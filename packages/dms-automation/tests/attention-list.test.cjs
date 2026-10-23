const assert = require("node:assert/strict");
const { test } = require("node:test");
const { frontendRequire, component } = require("./frontend.cjs");

// "Needs attention" keeps its height from the skeleton to the list: rows the
// shape of loaded ones, as many as the empty state is tall, and an empty
// state with no padding of its own around it.

const vue = frontendRequire("vue");
const { renderToString } = frontendRequire("vue/server-renderer");

globalThis.useTranslation = () => ({ processI18n: (value) => value });
globalThis.useI18n = () => ({ t: (key) => key, te: () => false });
globalThis.useToast = () => ({ add() {} });
globalThis.useRegionalFormat = () => ({
  dateTimeFormat: (options) => new Intl.DateTimeFormat("en", options),
});
globalThis.useAuthFetch = () => ({ $authFetch: async () => ({}) });
globalThis.describeApiError = (e) => String(e);
globalThis.refreshPageBlocks = async () => {};

const SlotStub = vue.defineComponent({
  inheritAttrs: false,
  setup:
    (_, { slots }) =>
    () =>
      vue.h("div", [slots.default?.()]),
});
const Skeleton = vue.defineComponent({
  setup: () => () => vue.h("i", { "data-skeleton": "" }),
});
const EmptyState = vue.defineComponent({
  setup: () => () => vue.h("section", { "data-empty": "" }),
});

async function render(state) {
  globalThis.useChartFetch = () => ({
    data: vue.ref(state.data),
    isLoading: vue.ref(state.isLoading),
    error: vue.ref(null),
    refresh() {},
  });
  const app = vue.createSSRApp({
    render: () =>
      vue.h(component("AttentionList.vue"), {
        fetchUrl: "/stats/attention",
        proceduresUrl: "/procedures",
        builderUrl: "/builder",
        traceUrl: "/trace",
        apiUrl: "/api",
      }),
  });
  app.config.globalProperties.$t = (key) => key;
  app.config.warnHandler = () => {};
  for (const name of ["DmsCard", "UButton", "UTooltip", "DmsStatusPill"])
    app.component(name, SlotStub);
  app.component("USkeleton", Skeleton);
  app.component("DmsEmptyState", EmptyState);
  return renderToString(app);
}

const ROW_PADDING = /<li class="[^"]*\bpx-4 py-3\b/g;

const row = (procedureId) => ({
  procedureId,
  name: procedureId,
  state: "degraded",
  runs: 4,
  failed: 1,
  streak: 0,
  since: null,
  lastRunId: null,
  lastFailure: null,
  recovered: true,
  armError: null,
  pausedAt: null,
  pausedBy: null,
  triggerType: null,
});

test("needs attention: the skeleton draws two rows padded as loaded rows are", async () => {
  const loading = await render({ isLoading: true, data: null });
  assert.equal(loading.match(ROW_PADDING)?.length, 2);
  // A name and two lines of reason per row.
  assert.equal(loading.match(/data-skeleton/g)?.length, 6);
  const loaded = await render({
    isLoading: false,
    data: { items: [row("a"), row("b")], total: 2 },
  });
  assert.equal(loaded.match(ROW_PADDING)?.length, 2);
  assert.doesNotMatch(loaded, /data-skeleton/);
});

test("needs attention: the empty state adds no padding of its own", async () => {
  const html = await render({
    isLoading: false,
    data: { items: [], total: 0 },
  });
  // The comment inside the branch is kept by the development compile only.
  assert.match(html, /<div>(?:<!--[^>]*-->)?<section data-empty/);
});
