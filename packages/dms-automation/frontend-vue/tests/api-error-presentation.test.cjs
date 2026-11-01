const assert = require("node:assert/strict");
const path = require("node:path");
const { beforeEach, after, test } = require("node:test");
const {
  FRONTEND,
  frontendRequire,
} = require("../../tests/helpers/frontend.cjs");
const { componentSetup, clientComposable } = require("./helpers/setup.cjs");
const { ref, computed, effectScope } = frontendRequire("vue");
const { createFetch } = frontendRequire("ofetch");
const { useApiErrorPresenter } = clientComposable(
  path.join(
    FRONTEND,
    "node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useApiErrorPresenter.ts",
  ),
);
const {
  useBuilderSave,
} = require("../app/build/composables/editor/useBuilderSave.ts");
const {
  useRunOverlay,
} = require("../app/build/composables/editor/useRunOverlay.ts");
const {
  useSaveAsTemplate,
} = require("../app/build/composables/editor/useSaveAsTemplate.ts");
const {
  useForkToLocal,
} = require("../app/build/composables/editor/useForkToLocal.ts");

const notices = [];
const readonlyTitle = "Read-only demo, changes are not saved";
const noop = () => {};
let scope;
let request;
let failure;
const read = () => ({
  data: ref(null),
  error: ref(null),
  pending: ref(false),
  refresh: noop,
});

beforeEach(() => {
  scope?.stop();
  scope = effectScope();
  notices.length = 0;
  const presented = ref(new WeakMap());
  Object.assign(globalThis, {
    useApiErrorPresenter,
    useToast: () => ({
      add: (notice) => {
        notices.push(notice);
        return { id: notices.length };
      },
    }),
    useDmsState: () => presented,
    getPluginI18n: () => ({
      i18n: {
        tm: (key) => {
          if (key === "error.read_only_demo") return readonlyTitle;
          if (key === "dms_automation.editor.dock.invalidJson")
            return "Invalid JSON";
          if (key === "error.500.description") return "Unexpected error";
          return {};
        },
        rt: (message) => message,
      },
    }),
    describeApiError: () => "Forbidden",
    apiErrorStatus: (error) => error?.response?.status,
    useApiData: read,
    useFieldErrors: () => ({ clear: noop }),
    useAuthFetch: () => ({ $authFetch: (...args) => request(...args) }),
    useI18n: () => ({ t: (key) => key, te: () => false }),
    useTranslation: () => ({ processI18n: (key) => key }),
    useRegionalFormat: () => ({}),
    useChartFetch: () => ({
      data: ref(null),
      error: ref(null),
      isLoading: ref(false),
    }),
  });
});
after(() => scope?.stop());

function context() {
  const selected = ref({ _id: "p1", name: "Draft", graph: { nodes: [] } });
  return {
    $authFetch: (...args) => request(...args),
    selected,
    editorMode: ref("procedure"),
    props: { apiUrl: "/api/automation" },
    t: (key) => key,
    toast: globalThis.useToast(),
    saving: ref(false),
    testing: ref(false),
    dockTab: ref("payload"),
    dockCollapsed: ref(true),
    issues: ref([]),
    saveBlocked: ref(false),
    savedSnapshot: ref(null),
    testPayload: ref("{}"),
    subgraphPath: ref([]),
    overlayRun: ref(null),
    overlayIsTest: ref(false),
    selectedNodeId: ref(null),
    testTriggerNodeId: ref(null),
    currentGraph: computed(() => selected.value.graph),
    selectedNode: ref({ id: "group", kind: "group", subgraph: { nodes: [] } }),
    isCurrentGraphReadOnly: ref(false),
    subgraphFrames: ref([]),
  };
}

const scenarios = [
  [
    "builder save",
    (ctx) => {
      const actions = useBuilderSave(
        ctx,
        { takeSnapshot: () => ({ name: "Draft", graph: {} }) },
        { nameMissing: ref(false), blockingIssues: ref([]) },
        {},
        {},
        {},
      );
      return { act: actions.onSave, pending: ctx.saving };
    },
  ],
  [
    "test run",
    (ctx) => {
      const actions = useRunOverlay(
        ctx,
        {},
        {},
        { selectedProcedureUrl: () => null },
        {},
      );
      return { act: actions.onTestRun, pending: ctx.testing };
    },
  ],
  [
    "save as template",
    (ctx) => {
      const actions = useSaveAsTemplate(ctx, {}, {}, {});
      actions.saveAsTemplateName.value = "Shared";
      return {
        act: actions.submitSaveAsTemplate,
        pending: actions.saveAsTemplateSubmitting,
      };
    },
  ],
  [
    "attention action",
    () => {
      const actions = componentSetup("AttentionList.vue", {
        apiUrl: "/api/automation",
      });
      return {
        act: () =>
          actions.act(
            { procedureId: "p1" },
            { url: "/enabled", method: "PUT" },
            {},
            "resumed",
          ),
        pending: actions.busy,
      };
    },
  ],
];

for (const [name, setup] of scenarios) {
  for (const corePresented of [false, true]) {
    void test(`${name} shows one translated warning for a JSON 403${corePresented ? " already presented by core" : ""}`, async () => {
      const fetch = createFetch({
        fetch: async () =>
          new Response(
            JSON.stringify({
              message: "error.read_only_demo",
              severity: "warning",
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          ),
        defaults: { retry: 0 },
      });
      const core = useApiErrorPresenter();
      request = async () => {
        try {
          return await fetch("https://example.test/write");
        } catch (error) {
          failure = error;
          if (corePresented)
            core.presentError(error, { fallbackKey: "error.500.description" });
          throw error;
        }
      };
      const action = scope.run(() => setup(context()));
      await action.act();
      assert.ok(!action.pending.value);
      assert.deepEqual(
        notices.map(({ title, color }) => ({ title, color })),
        [{ title: readonlyTitle, color: "warning" }],
      );
      core.presentError(failure, { fallbackKey: "error.500.description" });
      assert.equal(notices.length, 1);
    });
  }
}

test("fork refusal resolves the server key and warning inline without adding a toast", async () => {
  const ctx = context();
  ctx.selectedNode.value.templateId = "t1";
  const fetch = createFetch({
    fetch: async () =>
      new Response(
        JSON.stringify({
          message: "error.read_only_demo",
          severity: "warning",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      ),
    defaults: { retry: 0 },
  });
  request = () => fetch("https://example.test/template");
  const actions = scope.run(() => useForkToLocal(ctx, {}));
  await actions.submitFork();
  assert.equal(actions.forkSubmitting.value, false);
  assert.deepEqual(actions.forkError.value, {
    message: readonlyTitle,
    severity: "warning",
  });
  assert.deepEqual(notices, []);
});

test("invalid test payload stays a local validation error and makes no request", async () => {
  const ctx = context();
  ctx.testPayload.value = "{";
  request = () => assert.fail("Invalid JSON must not reach the backend");
  const actions = scope.run(() =>
    useRunOverlay(ctx, {}, {}, { selectedProcedureUrl: () => null }, {}),
  );
  await actions.onTestRun();
  assert.deepEqual(
    notices.map(({ title, color }) => ({ title, color })),
    [{ title: "Invalid JSON", color: "error" }],
  );
  assert.equal(ctx.dockTab.value, "payload");
  assert.equal(ctx.dockCollapsed.value, false);
});
