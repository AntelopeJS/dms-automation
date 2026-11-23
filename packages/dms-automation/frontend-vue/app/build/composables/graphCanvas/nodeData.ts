import { Position } from "@vue-flow/core";
import { computed } from "vue";
import type { NodeRunState } from "../../../components/Editor/nodes/GenericNode.vue";
import type {
  GraphNode as AppGraphNode,
  GroupPort,
  JsonSchema,
  ProcedureGraph,
} from "../../../composables/useGraphConnect";
import type {
  NodeKindUI,
  PortRef,
} from "../../../composables/useAutomationNodeKinds";
import { roleOf, summarizeNode } from "../../../utils/describe";
import {
  ariaLabelOf,
  handlesOf as handlesOfNode,
  propsOf,
  vfTypeFor,
} from "./handles";
import type { NodePorts } from "./handles";
import type { CanvasProps, CanvasText, NodeIssue } from "./types";
import { SENTINEL_KINDS } from "./types";

/** What a trigger, action or data node type of the registry tells the canvas. */
interface RegisteredType {
  name?: string;
  icon?: string;
  module?: string;
  category?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  configSchema?: JsonSchema;
}

/** The `data` payload of a Vue Flow node, as its renderer reads it. */
interface NodeData extends NodePorts {
  label?: string;
  typeName?: string;
  role?: ReturnType<typeof roleOf>;
  module?: string;
  summary?: string;
  run?: NodeRunState | null;
  issue?: NodeIssue | null;
  icon?: string;
  category?: string;
  typeId?: string;
  config?: AppGraphNode["config"];
  dataIns?: PortRef[];
  dataOuts?: PortRef[];
  ports?: GroupPort[];
  templateId?: string;
  subgraph?: ProcedureGraph;
}

/** The registered type a kind's `typeRegistry` hint points `typeId` into. */
function lookupTypeBySpec(
  props: Readonly<CanvasProps>,
  spec: NodeKindUI,
  typeId: string | undefined,
): RegisteredType | null {
  if (!spec.typeRegistry || !typeId) return null;
  if (spec.typeRegistry === "triggers")
    return props.triggerTypes.find((t) => t.id === typeId) ?? null;
  if (spec.typeRegistry === "actions")
    return props.actionTypes.find((a) => a.id === typeId) ?? null;
  if (spec.typeRegistry === "dataNodes")
    return props.dataNodeTypes.find((d) => d.id === typeId) ?? null;
  return null;
}

/** A schedule in words, once the server has worded its current expression. */
function scheduleTextOf(
  props: Readonly<CanvasProps>,
  { processText }: CanvasText,
  node: AppGraphNode,
): string | undefined {
  const cron = node.config?.cron;
  const worded = props.triggers?.find(
    (tr) => tr.nodeId === node.id && tr.cron === cron,
  );
  return worded ? processText(worded.text) : undefined;
}

/**
 * The validator's problem on a node, in the reader's language (its English
 * message when this version has no text for the code).
 */
function issueOf(
  props: Readonly<CanvasProps>,
  { t, te }: CanvasText,
  id: string,
): NodeIssue | null {
  const issue = props.issues?.get(id);
  if (!issue) return null;
  const key = `dms_automation.editor.problems.codes.${issue.code}`;
  return issue.code && te(key)
    ? { ...issue, message: t(key, issue.params ?? {}) }
    : issue;
}

/**
 * What the registered type of a node overrides in what its kind declares: type
 * names may be `$`-prefixed DMS i18n keys, and plain text passes through.
 */
function typedDetails(
  spec: NodeKindUI,
  type: RegisteredType | null,
  processI18n: CanvasText["processI18n"],
) {
  const typeName = type && spec.labelFromType ? type.name : undefined;
  return {
    label: processI18n(typeName ?? spec.label),
    icon: type && spec.iconFromType ? (type.icon ?? spec.icon) : spec.icon,
    category: type && spec.categoryFromType ? type.category : undefined,
    dataIns:
      type && spec.dataInsFromTypeSchema
        ? propsOf(type[spec.dataInsFromTypeSchema])
        : [...spec.staticDataIns],
    dataOuts:
      type && spec.dataOutsFromTypeSchema
        ? propsOf(type[spec.dataOutsFromTypeSchema])
        : [...spec.staticDataOuts],
  };
}

/**
 * The payload of every kind with `ui` metadata (all but group and sentinels),
 * resolved from the backend's `spec`, the node's `typeId` for type-registered
 * kinds and its `config` for dynamic trigger-out ports.
 */
function specNodeData(
  props: Readonly<CanvasProps>,
  text: CanvasText,
  node: AppGraphNode,
  spec: NodeKindUI,
): NodeData {
  const type = lookupTypeBySpec(props, spec, node.typeId);
  const { label, icon, category, dataIns, dataOuts } = typedDetails(
    spec,
    type,
    text.processI18n,
  );
  const configured = spec.dynamicTriggerOutsFromConfig
    ? node.config?.[spec.dynamicTriggerOutsFromConfig]
    : undefined;
  const dynPorts = Array.isArray(configured) ? configured.map(String) : [];
  return {
    label: node.label || label,
    typeName: label,
    role: roleOf(node.kind, spec.category),
    module: type?.module,
    summary: summarizeNode(
      node.kind,
      node.typeId,
      node.config,
      text.processI18n,
      scheduleTextOf(props, text, node),
    ),
    run: props.runStates?.get(node.id) ?? null,
    issue: issueOf(props, text, node.id),
    icon,
    category,
    typeId: node.typeId,
    config: node.config,
    hasTriggerIn: spec.hasTriggerIn,
    hasMainTriggerOut: spec.hasMainTriggerOut,
    triggerOuts: [...dynPorts, ...spec.staticTriggerOuts],
    dataIns,
    dataOuts,
  };
}

/**
 * A group node carries its own ports and a templateId or an inline subgraph,
 * which the renderer draws as handles and a linked badge. Its step name
 * (`label`) comes first, as for any node; `config.name` is the name the group
 * or its template was created with.
 */
function groupNodeData(
  props: Readonly<CanvasProps>,
  text: CanvasText,
  node: AppGraphNode,
): NodeData {
  const configName = node.config?.name;
  return {
    label:
      node.label ||
      (configName ? String(configName) : undefined) ||
      text.t("dms_automation.nodes.role.group"),
    run: props.runStates?.get(node.id) ?? null,
    issue: issueOf(props, text, node.id),
    ports: Array.isArray(node.ports) ? node.ports : [],
    templateId: node.templateId,
    subgraph: node.subgraph,
    config: node.config,
  };
}

/**
 * The sentinels render the ports of the parent group, so both share one
 * source of truth. At the procedure root there is no parent group: a stray
 * sentinel renders the ports it carries, normally none.
 */
function sentinelNodeData(
  props: Readonly<CanvasProps>,
  node: AppGraphNode,
): NodeData {
  if (Array.isArray(props.parentGroupPorts)) {
    return { ports: props.parentGroupPorts };
  }
  return { ports: Array.isArray(node.ports) ? node.ports : [] };
}

/**
 * The Vue Flow nodes of the graph. `menuName` tells two steps with the same
 * name apart by the end of their id (link menu, replacement toast, links read
 * aloud); a node without a label, as a group's sentinels, is named after the
 * group role.
 */
export function useCanvasNodes(props: Readonly<CanvasProps>, text: CanvasText) {
  const { t } = text;

  const nodeKindUiByKind = computed<Map<string, NodeKindUI>>(() => {
    const m = new Map<string, NodeKindUI>();
    for (const entry of props.nodeKinds ?? []) {
      if (entry.meta?.ui) m.set(entry.kind, entry.meta.ui);
    }
    return m;
  });

  function dataFor(node: AppGraphNode): NodeData {
    const spec = nodeKindUiByKind.value.get(node.kind);
    if (spec) return specNodeData(props, text, node, spec);
    if (node.kind === "group") return groupNodeData(props, text, node);
    if (node.kind === "groupInput" || node.kind === "groupOutput")
      return sentinelNodeData(props, node);
    return {};
  }

  const vfNodes = computed(() =>
    props.graph.nodes.map((n) => {
      const data = dataFor(n);
      return {
        id: n.id,
        type: vfTypeFor(n.kind),
        position: n.position,
        data,
        ariaLabel: SENTINEL_KINDS.has(n.kind)
          ? t(
              n.kind === "groupInput"
                ? "dms_automation.nodes.groupInput"
                : "dms_automation.nodes.groupOutput",
            )
          : ariaLabelOf(data),
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      };
    }),
  );

  const nodeNames = computed(
    () => new Map(vfNodes.value.map((n) => [n.id, n.data.label])),
  );

  function nodeName(id: string): string {
    return nodeNames.value.get(id) || t("dms_automation.nodes.role.group");
  }

  function menuName(id: string): string {
    const name = nodeName(id);
    const twins = props.graph.nodes.filter(
      (n) => nodeName(n.id) === name,
    ).length;
    return twins > 1 ? `${name} #${id.slice(-4)}` : name;
  }

  const handlesOf = (node: AppGraphNode) =>
    handlesOfNode(node, props.parentGroupPorts, dataFor);

  return { nodeKindUiByKind, handlesOf, vfNodes, menuName };
}
