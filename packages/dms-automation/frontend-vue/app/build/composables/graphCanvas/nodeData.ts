import { Position } from "@vue-flow/core";
import { computed } from "vue";
import type {
  GraphNode as AppGraphNode,
  JsonSchema,
} from "../../../composables/useGraphConnect";
import type { NodeKindUI } from "../../../composables/useAutomationNodeKinds";
import { roleOf, summarizeNode } from "../../../utils/describe";
import {
  ariaLabelOf,
  handlesOf as handlesOfNode,
  propsOf,
  vfTypeFor,
} from "./handles";
import type { CanvasProps, CanvasText, NodeIssue } from "./types";
import { SENTINEL_KINDS } from "./types";

export function useCanvasNodes(props: Readonly<CanvasProps>, text: CanvasText) {
  const { t, te, processI18n, processText } = text;

  // Index node-kind metadata by kind for O(1) lookup.
  const nodeKindUiByKind = computed<Map<string, NodeKindUI>>(() => {
    const m = new Map<string, NodeKindUI>();
    for (const entry of props.nodeKinds ?? []) {
      if (entry.meta?.ui) m.set(entry.kind, entry.meta.ui);
    }
    return m;
  });

  // Pull a registered TriggerType / ActionType / DataNodeType from the
  // type-registry prop indicated by a NodeKindUI.typeRegistry hint.
  function lookupTypeBySpec(spec: NodeKindUI, typeId: string | undefined) {
    if (!spec.typeRegistry || !typeId) return null;
    if (spec.typeRegistry === "triggers")
      return props.triggerTypes.find((t) => t.id === typeId) ?? null;
    if (spec.typeRegistry === "actions")
      return props.actionTypes.find((a) => a.id === typeId) ?? null;
    if (spec.typeRegistry === "dataNodes")
      return props.dataNodeTypes.find((d) => d.id === typeId) ?? null;
    return null;
  }

  // A schedule in words, once the server has worded its current expression.
  function scheduleTextOf(node: AppGraphNode): string | undefined {
    const cron = node.config?.cron;
    const worded = props.triggers?.find(
      (tr) => tr.nodeId === node.id && tr.cron === cron,
    );
    return worded ? processText(worded.text) : undefined;
  }

  // The validator's problem on a node, in the reader's language (its English
  // message when this version has no text for the code).
  function issueOf(id: string): NodeIssue | null {
    const issue = props.issues?.[id];
    if (!issue) return null;
    const key = `dms_automation.editor.problems.codes.${issue.code}`;
    return issue.code && te(key)
      ? { ...issue, message: t(key, issue.params ?? {}) }
      : issue;
  }

  // Build the GenericNode `data` payload from a graph node. For every kind
  // with `ui` metadata (every kind except group + sentinels), one
  // data-driven resolver applies: combine `spec` from the backend with the
  // node's `typeId` (for type-registered kinds) and `config` (for dynamic
  // trigger-out ports).
  function dataFor(node: AppGraphNode) {
    const spec = nodeKindUiByKind.value.get(node.kind);
    if (spec) {
      // Kind labels may be `$`-prefixed i18n keys too.
      let label = processI18n(spec.label);
      let icon = spec.icon;
      let category: string | undefined;
      let dataIns = [...spec.staticDataIns];
      let dataOuts = [...spec.staticDataOuts];

      const type = lookupTypeBySpec(spec, node.typeId) as {
        name?: string;
        icon?: string;
        category?: string;
        inputSchema?: JsonSchema;
        outputSchema?: JsonSchema;
        configSchema?: JsonSchema;
      } | null;
      if (type) {
        // Type names may be `$`-prefixed DMS i18n keys; plain text passes through.
        if (spec.labelFromType && type.name !== undefined)
          label = processI18n(type.name);
        if (spec.iconFromType) icon = type.icon ?? icon;
        if (spec.categoryFromType) category = type.category;
        if (spec.dataInsFromTypeSchema)
          dataIns = propsOf(type[spec.dataInsFromTypeSchema]);
        if (spec.dataOutsFromTypeSchema)
          dataOuts = propsOf(type[spec.dataOutsFromTypeSchema]);
      }

      const dynPorts = spec.dynamicTriggerOutsFromConfig
        ? ((node.config?.[spec.dynamicTriggerOutsFromConfig] as
            | string[]
            | undefined) ?? [])
        : [];
      const triggerOuts = [...dynPorts, ...spec.staticTriggerOuts];

      const own = (node as AppGraphNode & { label?: string }).label;
      const module = (type as { module?: string } | null)?.module;
      return {
        label: own || label,
        typeName: label,
        role: roleOf(node.kind, spec.category),
        module,
        summary: summarizeNode(
          node.kind,
          node.typeId,
          node.config,
          processI18n,
          scheduleTextOf(node),
        ),
        run: props.runStates?.[node.id] ?? null,
        issue: issueOf(node.id),
        icon,
        category,
        typeId: node.typeId,
        config: node.config,
        hasTriggerIn: spec.hasTriggerIn,
        hasMainTriggerOut: spec.hasMainTriggerOut,
        triggerOuts,
        dataIns,
        dataOuts,
      };
    }

    if (node.kind === "group") {
      // Group node carries its own port list + (optional) inline subgraph
      // or templateId. The fields live on the node itself (per backend
      // GroupNode interface) — surface them so the renderer can display
      // handles, linked badges, etc.
      const g = node as AppGraphNode & {
        label?: string;
        ports?: unknown;
        templateId?: string;
        subgraph?: unknown;
      };
      // Step name (`label`) first, as for any node; `config.name` is the name
      // the group or its template was created with.
      return {
        label:
          g.label ||
          (node.config?.name as string | undefined) ||
          t("dms_automation.nodes.role.group"),
        run: props.runStates?.[node.id] ?? null,
        issue: issueOf(node.id),
        ports: Array.isArray(g.ports) ? g.ports : [],
        templateId: g.templateId,
        subgraph: g.subgraph,
        config: node.config,
      };
    }
    if (node.kind === "groupInput" || node.kind === "groupOutput") {
      // Sentinels render the parent group's ports. In subgraph-editor
      // mode (C5.3) Editor.vue passes `parentGroupPorts` so both
      // sentinels share one source of truth — the outer group node.
      // At the procedure-graph root there's no parent group, so we
      // fall back to whatever ports the sentinel carries (which
      // should normally be none — a stray sentinel renders empty).
      if (Array.isArray(props.parentGroupPorts)) {
        return { ports: props.parentGroupPorts };
      }
      const s = node as AppGraphNode & { ports?: unknown };
      return { ports: Array.isArray(s.ports) ? s.ports : [] };
    }
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

  // How the canvas names a node in its messages: its label, else (a group's
  // sentinels) the group role.
  const nodeNames = computed(
    () =>
      new Map(
        vfNodes.value.map((n) => [n.id, (n.data as { label?: string }).label]),
      ),
  );
  function nodeName(id: string): string {
    return nodeNames.value.get(id) || t("dms_automation.nodes.role.group");
  }

  // Two steps with the same name are told apart by the end of their id (link
  // menu, replacement toast, links read aloud).
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
