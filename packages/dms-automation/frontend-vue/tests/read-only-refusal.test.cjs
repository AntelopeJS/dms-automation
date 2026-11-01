const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");
require("../../tests/helpers/frontend.cjs");
const { componentSetup } = require("./helpers/setup.cjs");
const { ref, computed, effectScope } = require("vue");
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
const {
  useReadOnlyRefusal,
} = require("../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useReadOnlyRefusal.ts");

const notices = [];
let presented = ref(new WeakSet());
let failure = Object.assign(new Error("Forbidden"), {
  response: new Response(),
});
let scope = effectScope();
const readonlyTitle = "Read-only demo, changes are not saved";
const noop = () => {};
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
  presented = ref(new WeakSet());
  Object.assign(globalThis, {
    useReadOnlyRefusal,
    useToast: () => ({ add: (notice) => notices.push(notice) }),
    useDmsState: () => presented,
    getAppTranslation: () => ({ processApiMessage: () => readonlyTitle }),
    describeApiError: () => "Forbidden",
    apiErrorStatus: () => 403,
    useApiData: read,
    useFieldErrors: () => ({ clear: noop }),
    useAuthFetch: () => ({ $authFetch: reject }),
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

async function reject() {
  useReadOnlyRefusal()(failure);
  throw failure;
}

function context() {
  const selected = ref({ _id: "p1", name: "Draft", graph: { nodes: [] } });
  const ctx = {
    $authFetch: reject,
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
    selectedNode: ref({
      id: "group",
      kind: "group",
      templateId: "t1",
      subgraph: { nodes: [] },
    }),
    isCurrentGraphReadOnly: ref(false),
    subgraphFrames: ref([]),
  };
  return ctx;
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
      delete ctx.selectedNode.value.templateId;
      const actions = useSaveAsTemplate(ctx, {}, {}, {});
      actions.saveAsTemplateName.value = "Shared";
      return {
        act: actions.submitSaveAsTemplate,
        pending: actions.saveAsTemplateSubmitting,
        error: actions.saveAsTemplateError,
      };
    },
  ],
  [
    "fork to local",
    (ctx) => {
      ctx.selected.value.graph.nodes.push(ctx.selectedNode.value);
      const actions = useForkToLocal(ctx, {});
      return {
        act: actions.submitFork,
        pending: actions.forkSubmitting,
        error: actions.forkError,
      };
    },
  ],
  [
    "attention action and undo presenter",
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
  for (const marked of [true, false]) {
    void test(`${name} ${marked ? "suppresses a local refusal notice" : "keeps an unmarked 403 visible"}`, async () => {
      failure = Object.assign(new Error("Forbidden"), {
        response: new Response(null, {
          status: 403,
          headers: marked ? { "x-dms-readonly": "1" } : {},
        }),
      });
      const action = scope.run(() => setup(context()));
      await action.act();
      assert.ok(!action.pending.value);
      if (marked) {
        assert.deepEqual(
          notices.map((notice) => notice.title),
          [readonlyTitle],
        );
        if (action.error) assert.equal(action.error.value, null);
      } else if (action.error) {
        assert.equal(action.error.value, "Forbidden");
      } else {
        assert.equal(notices.length, 1);
        assert.equal(notices[0].color, "error");
      }
    });
  }
}
