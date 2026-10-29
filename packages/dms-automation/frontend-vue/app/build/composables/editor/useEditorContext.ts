import { computed, ref } from "vue";
import type { DockTab } from "../../../components/Editor/BottomDock.vue";
import {
  type RunDetail,
  useAutomationRuns,
} from "../../../composables/useAutomationRuns";
import type { TemplateSummary } from "../../../composables/useAutomationNodeKinds";
import type {
  ActionType,
  DataNodeType,
  GraphNode,
  GroupPort,
  ProcedureGraph,
  TriggerType,
} from "../../../composables/useGraphConnect";
import { queryString } from "../../../utils/automation";
import type { WordedTrigger } from "../../../utils/describe";
import type {
  GraphIssue,
  ProcedureRecord,
  ProcedureSnapshot,
  SubgraphFrame,
  SubgraphPathSegment,
} from "../../types/editor";

/** What the builder takes from its props. */
export interface EditorProps {
  readonly apiUrl: string;
  readonly runsUrl: string;
  readonly traceUrl: string;
}

/**
 * The state the builder's parts share: the host composables it calls before
 * its first `await`, the reads of the palette's catalogs, the open
 * procedure, and what is derived from them.
 */
export function createEditorContext(props: EditorProps) {
  const route = useDmsRoute();
  const router = useDmsRouter();
  const { t, te, locale } = useI18n();
  const { dateTimeFormat } = useRegionalFormat();
  const { processI18n } = useTranslation();
  const { processText } = useComposedText();
  // Shortcut hints print ⌘ on macOS and Ctrl elsewhere, like the rest of the DMS.
  const { formatShortcut } = useKeyboardPlatform();

  /** The builder's own path, without the query its URL may carry. */
  function builderPath(): string {
    return route.path.split("?")[0] ?? route.path;
  }

  function queryValue(key: string): string | null {
    return queryString(route.query[key]);
  }

  const templateQueryId = computed(() => queryValue("template"));

  const editorMode = computed<"procedure" | "template">(() =>
    templateQueryId.value ? "template" : "procedure",
  );

  const editorTemplateId = computed<string | null>(() =>
    editorMode.value === "template" ? templateQueryId.value : null,
  );

  const { $authFetch } = useAuthFetch();
  const toast = useToast();
  // Composables are called before the first `await` of this setup: after it,
  // the component instance they inject from is gone.
  const { confirm } = useConfirm();
  const { confirmFrom } = useConfirmFrom();
  const runsApi = useAutomationRuns(props.apiUrl);
  // Leaving the page with unsaved changes goes through the DMS leave guard.
  const unsavedDraft = ref(false);
  useUnsavedChanges({ dirty: unsavedDraft });

  const procedures = ref<ProcedureRecord[]>([]);
  const selectedId = ref<string | null>(null);
  const switcherOpen = ref(false);
  const newProcedureOpen = ref(false);
  const runNowOpen = ref(false);
  const loading = ref(false);
  const loadError = ref<string | null>(null);
  // The `?selected=` of a procedure that no longer exists: the builder says so
  // instead of opening another one.
  const missingProcedureId = ref<string | null>(null);
  // `?template=` names a template that no longer exists.
  const templateNotFound = ref(false);
  const saving = ref(false);

  // Template-mode state. `templatePorts` holds the OUTER-face ports of the
  // edited template — they're not part of the editable subgraph but they ARE
  // the source of truth for the root-level groupInput/groupOutput sentinels'
  // handle sets. We pipe them through `currentParentGroupPorts` so GraphCanvas
  // renders them identically to how it renders a nested group's sentinels.
  const templatePorts = ref<GroupPort[]>([]);
  // Kept as loaded: saving the template from the editor must not reset its icon.
  const templateIcon = ref<string>("i-ph-package");

  // The palette's catalogs, read with the page. They are optional for
  // editing: one the server cannot answer is an empty list.
  const triggerTypesRead = useApiData<TriggerType[]>(
    "/api/automation/trigger-types",
  );
  const actionTypesRead = useApiData<ActionType[]>(
    "/api/automation/action-types",
  );
  const dataNodeTypesRead = useApiData<DataNodeType[]>(
    "/api/automation/data-node-types",
  );
  // Per-NodeKind UI metadata served by the backend
  // (`/api/automation/node-kinds`). Drives the editor's GenericNode renderer
  // so the frontend doesn't need to know about specific kinds.
  const nodeKindsRead = useAutomationNodeKinds();
  const triggerTypes = computed(() => triggerTypesRead.data.value ?? []);
  const actionTypes = computed(() => actionTypesRead.data.value ?? []);
  const dataNodeTypes = computed(() => dataNodeTypesRead.data.value ?? []);
  const nodeKinds = computed(() => nodeKindsRead.data.value ?? []);

  // Workspace-global templates surfaced in the canvas's node palette. Empty
  // list → palette section hidden (handled inside BuilderPalette).
  //
  // Only the fields the palette + template-instance creation need are kept,
  // and handed over with the page: the list endpoint also returns the
  // description, the usage count and the hydrated subgraph. Under a key of its
  // own, apart from the library's full rows of the same URL.
  const templatesRead = useApiData<TemplateSummary[]>(
    "/api/automation/templates",
    {
      key: "dms-automation-palette-templates",
      transform: (value) =>
        (value as { results: TemplateSummary[] }).results.map((t) => ({
          _id: t._id,
          name: t.name,
          icon: t.icon,
          ports: Array.isArray(t.ports) ? t.ports : [],
        })),
    },
  );
  const templates = computed(() => templatesRead.data.value ?? []);

  // Hide the palette section while editing a template (self-edit). The
  // server's cycle check would still catch any reference cycle, but blocking
  // it at the UI level keeps the UX cleaner — the user can't even attempt
  // to drop a template (including the one currently open) into itself.
  const palettesTemplates = computed<TemplateSummary[] | undefined>(() =>
    editorMode.value === "template" ? undefined : templates.value,
  );

  // Triggers live at the top level of a procedure: the palette offers none
  // inside a group or a template.
  const paletteTriggerTypes = computed<TriggerType[]>(() =>
    editorMode.value === "template" || subgraphPath.value.length > 1
      ? []
      : triggerTypes.value,
  );

  // Which graph the canvas shows (procedure or template, then the groups
  // entered): the canvas fits a new one into view.
  const canvasViewKey = computed(() =>
    [
      selectedId.value ?? "",
      ...subgraphPath.value.slice(1).map((segment) => segment.id),
    ].join("/"),
  );

  // Back to the Library's Templates tab, on the template being edited.
  const libraryBackUrl = computed(() =>
    editorTemplateId.value && !templateNotFound.value
      ? `/modules/automation/library?tab=templates&template=${editorTemplateId.value}`
      : "/modules/automation/library?tab=templates",
  );

  const selectedNodeId = ref<string | null>(null);
  // Mirrors GraphCanvas's @selection-change — full set of currently selected
  // node ids in the canvas, sentinel-filtered. Drives the "Group selection"
  // toolbar button (see canGroupSelection / createGroupFromSelection).
  const selectedNodeIds = ref<string[]>([]);

  function onSelectionChange(payload: { ids: string[] }) {
    selectedNodeIds.value = payload.ids;
  }

  const subgraphPath = ref<SubgraphPathSegment[]>([]);

  const savedSnapshot = ref<ProcedureSnapshot | null>(null);

  const selected = computed<ProcedureRecord | null>(
    () => procedures.value.find((p) => p._id === selectedId.value) ?? null,
  );

  const subgraphFrames = computed<SubgraphFrame[]>(() => {
    const p = selected.value;
    if (!p) return [];
    const path = subgraphPath.value;
    if (path.length === 0) return [];
    const frames: SubgraphFrame[] = [
      { segment: path[0]!, graph: p.graph, groupNode: null },
    ];
    for (let i = 1; i < path.length; i++) {
      const seg = path[i]!;
      const parent = frames[i - 1]!;
      const node = parent.graph.nodes.find(
        (n) => n.id === seg.id && n.kind === "group",
      );
      if (!node) break;
      // Local group → inline subgraph. Template instance → no inline
      // subgraph on the client, so we can't navigate in. The
      // double-click handler guards against pushing a template-instance
      // segment in the first place; this is a safety net.
      const sub = node.subgraph;
      if (!sub) break;
      frames.push({ segment: seg, graph: sub, groupNode: node });
    }
    return frames;
  });

  const currentGraph = computed<ProcedureGraph | null>(() => {
    const frames = subgraphFrames.value;
    if (frames.length === 0) return null;
    return frames[frames.length - 1]!.graph;
  });

  // The parent group node whose subgraph we're currently viewing — null at
  // the procedure root.
  const currentParentGroup = computed<GraphNode | null>(() => {
    const frames = subgraphFrames.value;
    if (frames.length <= 1) return null;
    return frames[frames.length - 1]!.groupNode;
  });

  const currentParentGroupPorts = computed<GroupPort[] | undefined>(() => {
    const g = currentParentGroup.value;
    if (g) return Array.isArray(g.ports) ? g.ports : [];
    // Root level in template mode: the template's own `ports` are the
    // outer-face of the edited subgraph. Inject them so the root-level
    // groupInput / groupOutput sentinels render the right handles.
    if (editorMode.value === "template") return templatePorts.value;
    return undefined;
  });

  // Read-only mode kicks in when viewing the inner subgraph of a template
  // instance (a group node carrying `templateId`). The fork action lets
  // the user promote it to a local group; until then we just show a
  // banner and disable mutations.
  const isCurrentGraphReadOnly = computed<boolean>(() => {
    const g = currentParentGroup.value;
    if (!g) return false;
    return Boolean(g.templateId);
  });

  const selectedNode = computed<GraphNode | null>(() => {
    const id = selectedNodeId.value;
    if (!id) return null;
    // Lookup is scoped to whichever graph the canvas is currently
    // bound to, not always the procedure root — otherwise selecting a
    // node inside a subgraph would resolve to null.
    const g = currentGraph.value;
    if (!g) return null;
    return g.nodes.find((n) => n.id === id) ?? null;
  });

  const selectedNodeTriggerType = computed<TriggerType | null>(() => {
    const n = selectedNode.value;
    if (!n || n.kind !== "trigger") return null;
    return triggerTypes.value.find((t) => t.id === n.typeId) ?? null;
  });

  const selectedNodeActionType = computed<ActionType | null>(() => {
    const n = selectedNode.value;
    if (!n || n.kind !== "action") return null;
    return actionTypes.value.find((a) => a.id === n.typeId) ?? null;
  });

  // The node palette lives in the left BuilderPalette sidebar; its add events are
  // forwarded to the canvas' exposed helpers via this template ref.
  const graphCanvasRef = ref<{
    addNode: (kind: string, typeId?: string) => void;
    addTemplateInstance: (template: {
      _id: string;
      name: string;
      icon?: string;
      ports: GroupPort[];
    }) => void;
  } | null>(null);

  const inspectorRef = ref<HTMLElement | null>(null);

  const issues = ref<GraphIssue[]>([]);
  // The draft's triggers, worded by the server with its problems: the canvas
  // and the test dock name them.
  const draftTriggers = ref<WordedTrigger[]>([]);

  const dockTab = ref<DockTab>("problems");
  // The dock stays out of the canvas's way until it has something to say: it
  // opens on its own for a problem that blocks enabling (a warning only counts
  // on its tab), and closes again once that is fixed, unless the user has
  // taken it over in between.
  const dockCollapsed = ref(true);

  /** Set when a save was refused for problems: the banner offers the way out. */
  const saveBlocked = ref(false);

  /** The run shown over the canvas, and whether it is a test of the draft. */
  const overlayRun = ref<RunDetail | null>(null);
  const overlayIsTest = ref(false);
  const testing = ref(false);
  const testPayload = ref("{}");
  const testPayloadSource = ref<string | null>(null);
  // The trigger a Test run starts from, chosen in the dock (see the watch on
  // the draft's triggers at the end).
  const testTriggerNodeId = ref<string | undefined>(undefined);

  return {
    props,
    route,
    router,
    t,
    te,
    locale,
    dateTimeFormat,
    processI18n,
    processText,
    formatShortcut,
    builderPath,
    queryValue,
    editorMode,
    editorTemplateId,
    $authFetch,
    toast,
    confirm,
    confirmFrom,
    runsApi,
    unsavedDraft,
    procedures,
    selectedId,
    switcherOpen,
    newProcedureOpen,
    runNowOpen,
    loading,
    loadError,
    missingProcedureId,
    templateNotFound,
    saving,
    templatePorts,
    templateIcon,
    triggerTypes,
    actionTypes,
    dataNodeTypes,
    nodeKinds,
    templatesRead,
    templates,
    palettesTemplates,
    paletteTriggerTypes,
    canvasViewKey,
    libraryBackUrl,
    selectedNodeId,
    selectedNodeIds,
    onSelectionChange,
    subgraphPath,
    savedSnapshot,
    selected,
    subgraphFrames,
    currentGraph,
    currentParentGroup,
    currentParentGroupPorts,
    isCurrentGraphReadOnly,
    selectedNode,
    selectedNodeTriggerType,
    selectedNodeActionType,
    graphCanvasRef,
    inspectorRef,
    issues,
    draftTriggers,
    dockTab,
    dockCollapsed,
    saveBlocked,
    overlayRun,
    overlayIsTest,
    testing,
    testPayload,
    testPayloadSource,
    testTriggerNodeId,
  };
}

export type EditorContext = ReturnType<typeof createEditorContext>;
