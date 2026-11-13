const assert = require("node:assert/strict");
const path = require("node:path");
const { after, beforeEach, test } = require("node:test");
const { FRONTEND } = require("../../tests/helpers/frontend.cjs");
const { clientComposable, componentSetup } = require("./helpers/setup.cjs");
const { computed, effectScope, ref } = require("vue");
const { useApiErrorPresenter } = clientComposable(
  path.join(
    FRONTEND,
    "node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useApiErrorPresenter.ts",
  ),
);
const {
  useRunOverlay,
} = require("../app/build/composables/editor/useRunOverlay.ts");
const {
  useDraftProblems,
} = require("../app/build/composables/editor/useDraftProblems.ts");
const {
  useCanvasNodes,
} = require("../app/build/composables/graphCanvas/nodeData.ts");
const {
  useCanvasEdges,
} = require("../app/build/composables/graphCanvas/edges.ts");

/**
 * Node and type ids a plain object answers for without owning them, and
 * `__proto__`, which an assignment turns into a prototype.
 */
const INHERITED_NAMES = [
  "constructor",
  "toString",
  "hasOwnProperty",
  "__proto__",
];

/**
 * The names a run step keeps whole: in a step id, `__` separates a group
 * from the step inside it.
 */
const STEP_NAMES = INHERITED_NAMES.filter((name) => !name.includes("__"));

const noop = () => {};
const key = (/** @type {string} */ k) => k;
const read = (/** @type {unknown} */ data) => ({
  data: ref(data),
  error: ref(null),
  pending: ref(false),
  refresh: noop,
});
let scope = effectScope();

beforeEach(() => {
  scope.stop();
  scope = effectScope();
  Object.assign(globalThis, {
    useApiErrorPresenter,
    useToast: () => ({ add: noop }),
    useDmsState: () => ref(new WeakMap()),
    getPluginI18n: () => ({ i18n: { tm: () => ({}), rt: key } }),
    useApiData: () => read(null),
    useI18n: () => ({ t: key, te: () => false }),
    useTranslation: () => ({ processI18n: key }),
    useRegionalFormat: () => ({}),
  });
});
after(() => scope.stop());

/** @param {string} id */
const group = (id) => ({
  id,
  kind: "group",
  position: { x: 0, y: 0 },
  ports: [],
});

/**
 * The canvas of a graph of groups `ids`, chained in order, under the run
 * that went through `ran` and the validator's warning on each of `warned`.
 * @param {string[]} ids
 * @param {{ ran?: string[]; warned?: string[] }} draft
 */
function canvasOf(ids, { ran = [], warned = [] }) {
  const graph = {
    nodes: ids.map(group),
    triggerEdges: ids.slice(1).map((id, i) => ({
      id: `e${i}`,
      from: { node: ids[i] },
      to: { node: id },
    })),
    dataEdges: [],
  };
  const ctx = {
    selected: ref({ _id: "p1", name: "Draft", graph }),
    selectedId: ref("p1"),
    editorMode: ref("procedure"),
    props: { apiUrl: "/api/automation" },
    t: key,
    te: () => false,
    processI18n: key,
    dockTab: ref("problems"),
    dockCollapsed: ref(true),
    issues: ref(
      warned.map((nodeId) => ({ nodeId, severity: "warning", message: "m" })),
    ),
    saveBlocked: ref(false),
    savedSnapshot: ref(null),
    testPayload: ref("{}"),
    subgraphPath: ref([]),
    overlayRun: ref({
      trace: {
        steps: ran.map((nodeId) => ({
          nodeId,
          status: "ok",
          durationMs: 5,
        })),
        skipped: [],
      },
    }),
    overlayIsTest: ref(false),
    selectedNodeId: ref(null),
    currentGraph: computed(() => graph),
    procedures: ref([]),
    templatePorts: ref([]),
    draftTriggers: ref([]),
    nodeKinds: ref([]),
    triggerTypes: ref([]),
    actionTypes: ref([]),
    dataNodeTypes: ref([]),
  };
  return scope.run(() => {
    const { runStates } = useRunOverlay(
      ctx,
      {},
      {},
      { selectedProcedureUrl: () => null },
      {},
    );
    const { issuesByNode } = useDraftProblems(
      ctx,
      { pushHistory: noop },
      { groupName: key },
    );
    const props = {
      graph,
      nodeKinds: [],
      triggerTypes: [],
      actionTypes: [],
      dataNodeTypes: [],
      runStates: runStates.value,
      issues: issuesByNode.value,
    };
    const text = {
      t: key,
      te: () => false,
      processI18n: key,
      processText: key,
    };
    const { vfNodes, menuName } = useCanvasNodes(props, text);
    const edges = useCanvasEdges(props, menuName);
    return {
      /** @param {string} id */
      data: (id) => vfNodes.value.find((n) => n.id === id)?.data,
      edgeClass: () => edges.value[0]?.class,
    };
  });
}

for (const name of STEP_NAMES) {
  void test(`a node with the id ${name} shows its own run state`, () => {
    const canvas = canvasOf([name], { ran: [name] });
    assert.deepEqual(canvas.data(name)?.run, { status: "ok", durationMs: 5 });
  });
}

for (const name of INHERITED_NAMES) {
  void test(`a node with the id ${name} the run skipped shows no run state`, () => {
    const canvas = canvasOf([name, "next"], { ran: ["next"] });
    assert.equal(canvas.data(name)?.run, null);
    assert.equal(canvas.edgeClass(), "edge-trigger edge-idle");
  });

  void test(`a node with the id ${name} shows its own warning`, () => {
    const canvas = canvasOf([name], { warned: [name] });
    assert.equal(canvas.data(name)?.issue?.severity, "warning");
    assert.equal(canvas.data(name)?.issue?.message, "m");
  });

  void test(`a node with the id ${name} the validator passed shows no problem`, () => {
    const canvas = canvasOf([name, "next"], { warned: ["next"] });
    assert.equal(canvas.data(name)?.issue, null);
  });

  void test(`a step ${name} the last success never ran compares with nothing`, () => {
    const { rows } = componentSetup("Run/RunCompare.vue", {
      run: {
        trace: {
          steps: [
            {
              nodeId: name,
              name: { nodeId: name },
              status: "ok",
              durationMs: 5,
            },
          ],
          skipped: [],
        },
        graph: null,
        lastSuccess: { stepDurations: JSON.parse('{"other":3}') },
      },
      traceUrl: "/t",
    });
    assert.deepEqual(
      rows.value.map((row) => [row.nodeId, row.before, row.now]),
      [
        [name, null, 5],
        ["other", 3, null],
      ],
    );
  });
}

for (const name of INHERITED_NAMES) {
  void test(`a catalog entry ${name} no procedure places counts no use`, () => {
    Object.assign(globalThis, {
      useApiData: (/** @type {string} */ url) =>
        read(url.includes("/library/usage/") ? {} : [{ id: name, name }]),
      useAuthFetch: () => ({ $authFetch: noop }),
      useComposedText: () => ({ processText: key }),
      useConfirm: () => ({ confirm: noop }),
      useDmsRoute: () => ({ query: {} }),
      useDmsRouter: () => ({ replace: noop }),
      describeApiError: key,
    });
    const catalog = scope.run(() =>
      componentSetup("LibraryCatalog.vue", {
        kind: "triggers",
        apiUrl: "/api/automation",
        builderUrl: "/b",
      }),
    );
    assert.equal(catalog.useCount(name), 0);
  });
}
