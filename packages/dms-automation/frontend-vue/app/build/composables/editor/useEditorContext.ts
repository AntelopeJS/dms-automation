import { computed, ref, type Ref } from "vue";
import type { DockTab } from "../../../components/Editor/BottomDock.vue";
import {
  type RunDetail,
  useAutomationRuns,
} from "../../../composables/useAutomationRuns";
import {
  type TemplateSummary,
  useAutomationNodeKinds,
} from "../../../composables/useAutomationNodeKinds";
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
import { isRecord, isString } from "../../../utils/json";
import { isGroupPort } from "./valueGuards";

/** What the builder takes from its props. */
export interface EditorProps {
  readonly apiUrl: string;
  readonly runsUrl: string;
  readonly traceUrl: string;
}

/** A template as the palette hands it to the canvas to drop in as an instance. */
export interface TemplateInstanceSeed {
  _id: string;
  name: string;
  icon?: string;
  ports: GroupPort[];
}

/** What the canvas exposes for the palette's add events. */
interface GraphCanvasHandle {
  addNode: (kind: string, typeId?: string) => void;
  addTemplateInstance: (template: TemplateInstanceSeed) => void;
}

type EditorMode = "procedure" | "template";

interface TemplateListRow {
  _id: string;
  name: string;
  icon?: string;
  ports?: GroupPort[];
}

function isTemplateListRow(value: unknown): value is TemplateListRow {
  return (
    isRecord(value) &&
    isString(value._id) &&
    isString(value.name) &&
    (value.icon === undefined || isString(value.icon)) &&
    (value.ports === undefined ||
      (Array.isArray(value.ports) && value.ports.every(isGroupPort)))
  );
}

interface TemplateList {
  results: TemplateListRow[];
}

function isTemplateList(value: unknown): value is TemplateList {
  return (
    isRecord(value) &&
    Array.isArray(value.results) &&
    value.results.every(isTemplateListRow)
  );
}

/** Only the fields the palette and the creation of a template instance need: the list endpoint also returns the description, the usage count and the hydrated subgraph. An answer that is not a list of templates is none. */
function paletteTemplates(list: TemplateList): TemplateSummary[] {
  return list.results.map((row) => ({
    _id: row._id,
    name: row.name,
    icon: row.icon,
    ports: row.ports ?? [],
  }));
}

/** The host composables the builder calls before its first `await`: after it, the component instance they inject from is gone. The leave guard of the DMS holds a page left with unsaved changes. */
function useEditorHost(props: EditorProps) {
  const route = useDmsRoute();
  const router = useDmsRouter();
  const i18n = useI18n();
  const { t, locale } = i18n;
  const { dateTimeFormat } = useRegionalFormat();
  const { processI18n } = useTranslation();
  const { processText } = useComposedText();
  const { formatShortcut } = useKeyboardPlatform();

  function builderPath(): string {
    return route.path.split("?")[0] ?? route.path;
  }

  function queryValue(key: string): string | null {
    return queryString(route.query[key]);
  }

  const templateQueryId = computed(() => queryValue("template"));

  const editorMode = computed<EditorMode>(() =>
    templateQueryId.value ? "template" : "procedure",
  );

  const editorTemplateId = computed<string | null>(() =>
    editorMode.value === "template" ? templateQueryId.value : null,
  );

  const { $authFetch } = useAuthFetch();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { confirmFrom } = useConfirmFrom();
  const runsApi = useAutomationRuns(props.apiUrl);
  const unsavedDraft = ref(false);
  useUnsavedChanges({ dirty: unsavedDraft });

  return {
    props,
    route,
    router,
    t,
    te: (key: string): boolean => i18n.te(key),
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
  };
}

/** The refs of the open procedure, of the canvas's selection and path, of the dock and of the test run. */
function useEditorState() {
  const subgraphPath = ref<SubgraphPathSegment[]>([]);
  return {
    procedures: ref<ProcedureRecord[]>([]),
    selectedId: ref<string | null>(null),
    switcherOpen: ref(false),
    newProcedureOpen: ref(false),
    runNowOpen: ref(false),
    loading: ref(false),
    loadError: ref<string | null>(null),
    missingProcedureId: ref<string | null>(null),
    templateNotFound: ref(false),
    saving: ref(false),
    templatePorts: ref<GroupPort[]>([]),
    templateIcon: ref<string>("i-ph-package"),
    selectedNodeId: ref<string | null>(null),
    selectedNodeIds: ref<string[]>([]),
    subgraphPath,
    savedSnapshot: ref<ProcedureSnapshot | null>(null),
    graphCanvasRef: ref<GraphCanvasHandle | null>(null),
    inspectorRef: ref<HTMLElement | null>(null),
    issues: ref<GraphIssue[]>([]),
    draftTriggers: ref<WordedTrigger[]>([]),
    dockTab: ref<DockTab>("problems"),
    dockCollapsed: ref(true),
    saveBlocked: ref(false),
    overlayRun: ref<RunDetail | null>(null),
    overlayIsTest: ref(false),
    testing: ref(false),
    testPayload: ref("{}"),
    testPayloadSource: ref<string | null>(null),
    testTriggerNodeId: ref<string | undefined>(undefined),
  };
}

/** The palette's catalogs, read with the page. They are optional for editing: one the server cannot answer is an empty list. The templates are kept under a key of their own, apart from the library's full rows of the same URL. */
function useCatalogs(
  editorMode: Readonly<Ref<EditorMode>>,
  subgraphPath: Readonly<Ref<SubgraphPathSegment[]>>,
) {
  const triggerTypesRead = useApiData<TriggerType[]>(
    "/api/automation/trigger-types",
  );
  const actionTypesRead = useApiData<ActionType[]>(
    "/api/automation/action-types",
  );
  const dataNodeTypesRead = useApiData<DataNodeType[]>(
    "/api/automation/data-node-types",
  );
  const nodeKindsRead = useAutomationNodeKinds();
  const triggerTypes = computed(() => triggerTypesRead.data.value ?? []);
  const actionTypes = computed(() => actionTypesRead.data.value ?? []);
  const dataNodeTypes = computed(() => dataNodeTypesRead.data.value ?? []);
  const nodeKinds = computed(() => nodeKindsRead.data.value ?? []);

  const templatesRead = useApiData<TemplateSummary[]>(
    "/api/automation/templates",
    {
      key: "dms-automation-palette-templates",
      transform: (value) =>
        isTemplateList(value) ? paletteTemplates(value) : [],
    },
  );
  const templates = computed(() => templatesRead.data.value ?? []);

  const palettesTemplates = computed<TemplateSummary[] | undefined>(() =>
    editorMode.value === "template" ? undefined : templates.value,
  );

  const paletteTriggerTypes = computed<TriggerType[]>(() =>
    editorMode.value === "template" || subgraphPath.value.length > 1
      ? []
      : triggerTypes.value,
  );

  return {
    triggerTypes,
    actionTypes,
    dataNodeTypes,
    nodeKinds,
    templatesRead,
    templates,
    palettesTemplates,
    paletteTriggerTypes,
  };
}

/** The frames from the procedure root down the path, as far as the path still leads: a template instance has no inline subgraph on the client, so the walk stops at it. */
function framesOf(
  root: ProcedureGraph,
  path: SubgraphPathSegment[],
): SubgraphFrame[] {
  const [first, ...entered] = path;
  if (!first) return [];
  let frame: SubgraphFrame = {
    segment: first,
    graph: root,
    groupNode: null,
  };
  const frames = [frame];
  for (const seg of entered) {
    const node = frame.graph.nodes.find(
      (n) => n.id === seg.id && n.kind === "group",
    );
    if (!node?.subgraph) break;
    frame = { segment: seg, graph: node.subgraph, groupNode: node };
    frames.push(frame);
  }
  return frames;
}

/** What is derived from the open procedure, the path into its groups and the selected step. */
function useOpenGraph(
  host: ReturnType<typeof useEditorHost>,
  state: ReturnType<typeof useEditorState>,
  catalogs: ReturnType<typeof useCatalogs>,
) {
  const { editorMode, editorTemplateId } = host;
  const { procedures, selectedId, selectedNodeId, subgraphPath } = state;

  const canvasViewKey = computed(() =>
    [
      selectedId.value ?? "",
      ...subgraphPath.value.slice(1).map((segment) => segment.id),
    ].join("/"),
  );

  const libraryBackUrl = computed(() =>
    editorTemplateId.value && !state.templateNotFound.value
      ? `/modules/automation/library?tab=templates&template=${editorTemplateId.value}`
      : "/modules/automation/library?tab=templates",
  );

  function onSelectionChange(payload: { ids: string[] }) {
    state.selectedNodeIds.value = payload.ids;
  }

  const selected = computed<ProcedureRecord | null>(
    () => procedures.value.find((p) => p._id === selectedId.value) ?? null,
  );

  const subgraphFrames = computed<SubgraphFrame[]>(() =>
    selected.value ? framesOf(selected.value.graph, subgraphPath.value) : [],
  );

  const currentGraph = computed<ProcedureGraph | null>(
    () => subgraphFrames.value.at(-1)?.graph ?? null,
  );

  const currentParentGroup = computed<GraphNode | null>(() =>
    subgraphFrames.value.length <= 1
      ? null
      : (subgraphFrames.value.at(-1)?.groupNode ?? null),
  );

  const currentParentGroupPorts = computed<GroupPort[] | undefined>(() => {
    const g = currentParentGroup.value;
    if (g) return Array.isArray(g.ports) ? g.ports : [];
    if (editorMode.value === "template") return state.templatePorts.value;
    return undefined;
  });

  const isCurrentGraphReadOnly = computed<boolean>(() => {
    const g = currentParentGroup.value;
    if (!g) return false;
    return Boolean(g.templateId);
  });

  const selectedNode = computed<GraphNode | null>(() => {
    const id = selectedNodeId.value;
    if (!id) return null;
    const g = currentGraph.value;
    if (!g) return null;
    return g.nodes.find((n) => n.id === id) ?? null;
  });

  const selectedNodeTriggerType = computed<TriggerType | null>(() => {
    const n = selectedNode.value;
    if (!n || n.kind !== "trigger") return null;
    return catalogs.triggerTypes.value.find((t) => t.id === n.typeId) ?? null;
  });

  const selectedNodeActionType = computed<ActionType | null>(() => {
    const n = selectedNode.value;
    if (!n || n.kind !== "action") return null;
    return catalogs.actionTypes.value.find((a) => a.id === n.typeId) ?? null;
  });

  return {
    canvasViewKey,
    libraryBackUrl,
    onSelectionChange,
    selected,
    subgraphFrames,
    currentGraph,
    currentParentGroup,
    currentParentGroupPorts,
    isCurrentGraphReadOnly,
    selectedNode,
    selectedNodeTriggerType,
    selectedNodeActionType,
  };
}

/**
 * The state the builder's parts share: the host composables it calls before
 * its first `await`, the reads of the palette's catalogs, the open
 * procedure, and what is derived from them.
 */
export function createEditorContext(props: EditorProps) {
  const host = useEditorHost(props);
  const state = useEditorState();
  const catalogs = useCatalogs(host.editorMode, state.subgraphPath);
  const openGraph = useOpenGraph(host, state, catalogs);
  return { ...host, ...state, ...catalogs, ...openGraph };
}

export type EditorContext = ReturnType<typeof createEditorContext>;
