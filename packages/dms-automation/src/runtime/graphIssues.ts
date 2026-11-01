import type { JsonSchema } from "@antelopejs/interface-dms-automation";
import {
  type GraphNode,
  isGroupNode,
  type ProcedureGraph,
  walkNodesRecursive,
} from "../types/graph";
import { MAX_FOR_RANGE_ITERATIONS } from "./builtins/nodes/forRange";
import { cronProblem, cronTrigger } from "./builtins/triggers/cron";
import {
  armedWebhookRouteIds,
  webhookPathProblem,
  webhookRouteConflict,
  webhookRouteOf,
  webhookTrigger,
} from "./builtins/triggers/webhook";
import { nodeKinds } from "./nodeKinds";
import { registry } from "./registry";
import { isActionTypeDisabled, isTriggerTypeDisabled } from "./typeSwitches";
import {
  type ConfigProblem,
  type GraphProblem,
  graphProblems,
  type ProblemParams,
} from "./validate";
import { propertiesOf, type SchemaProperty } from "./schemaProperties";
import type { DataRecord, DataValue } from "../types/dataValue";
import { isNumber, isString } from "../types/guards";

/** How much a problem on the graph matters: an error blocks enabling. */
type GraphIssueSeverity = "error" | "warning";

/**
 * One problem on a graph, tied to the top-level node it concerns, so the
 * builder can select and mark that node. `code` and `params` let the UI word
 * it in the user's language (`dms_automation.editor.problems.codes.<code>`);
 * `message` is the English fallback.
 */
export type GraphIssue = {
  severity: GraphIssueSeverity;
  code: string;
  params?: ProblemParams;
  message: string;
  nodeId?: string;
};

export interface GraphIssueOptions {
  /**
   * The graph is about to run on its own (an enabled procedure): a missing
   * setting then blocks, and the graph needs a trigger.
   */
  enabling?: boolean;
  /** The templates group nodes may reference; unchecked when absent. */
  templates?: { has(id: string): boolean };
}

/** Sentinels and data nodes are not steps: nothing has to trigger them. */
const NOT_TRIGGERED_KINDS = new Set(["trigger", "data", "groupInput", "group"]);

const TYPE_LOOKUP = new Map<string, (id: string) => object | undefined>([
  ["trigger", (id) => registry.getTrigger(id)],
  ["action", (id) => registry.getAction(id)],
  ["data", (id) => registry.getDataNode(id)],
]);

const DISABLED_LOOKUP = new Map<string, (id: string) => boolean>([
  ["trigger", isTriggerTypeDisabled],
  ["action", isActionTypeDisabled],
]);

/** Settings a trigger type checks beyond its schema. */
const CONFIG_CHECKS = new Map<
  string,
  (config: DataRecord) => ConfigProblem | undefined
>([
  [cronTrigger.id, (config) => cronProblem(config.cron)],
  /**
   * This module's armed webhooks are left out: a procedure's own webhook
   * is no conflict, and another procedure's is checked on the procedures.
   */
  [
    webhookTrigger.id,
    (config) => {
      const { method, path } = webhookRouteOf(config);
      return (
        webhookPathProblem(config.path) ??
        webhookRouteConflict(method, path, armedWebhookRouteIds())
      );
    },
  ],
]);

const FOR_RANGE_DEFAULTS = new Map([
  ["start", 0],
  ["end", 0],
  ["step", 1],
]);
const CONSTANT_NUMBER = "const.number";

function issueOf(problem: GraphProblem): GraphIssue {
  const { severity, code, params, message, nodeId } = problem;
  const issue: GraphIssue = { severity, code, params, message };
  if (nodeId !== undefined) issue.nodeId = nodeId;
  return issue;
}

/**
 * Every node of a graph, nested local groups included, with the top-level
 * node an issue about it is reported on and the graph level that holds it.
 */
function* stepsOf(
  graph: ProcedureGraph,
  reportOn?: string,
): Iterable<{ node: GraphNode; level: ProcedureGraph; reportOn: string }> {
  for (const node of graph.nodes) {
    const on = reportOn ?? node.id;
    yield { node, level: graph, reportOn: on };
    if (isGroupNode(node) && node.subgraph) yield* stepsOf(node.subgraph, on);
  }
}

/**
 * Steps nothing triggers: a step without an incoming trigger edge never runs.
 * Data nodes are evaluated on demand and trigger nodes are entry points, so
 * neither is reported.
 */
function untriggeredSteps(graph: ProcedureGraph): string[] {
  const triggered = new Set(graph.triggerEdges.map((e) => e.to.node));
  return graph.nodes
    .filter((n) => !NOT_TRIGGERED_KINDS.has(n.kind))
    .filter((n) => nodeKinds.has(n.kind) && !triggered.has(n.id))
    .map((n) => n.id);
}

/** The schema of a node's settings: its type's, or its kind's. */
function settingsSchemaOf(node: GraphNode): JsonSchema | undefined {
  if (node.kind === "trigger" && node.typeId) {
    return registry.getTrigger(node.typeId)?.configSchema;
  }
  if (node.kind === "action" && node.typeId) {
    return registry.getAction(node.typeId)?.inputSchema;
  }
  if (node.kind === "data") return undefined;
  return nodeKinds.metaOf(node.kind)?.ui?.configSchema;
}

/** The words a problem names a setting by: its key and its label. */
type FieldParams = {
  field: string;
  label: string;
};

/**
 * How a problem names a setting: its schema title when that is plain text,
 * else its key in words ("maxAttempts" → "Max attempts"), as the inspector
 * labels it. `field` keeps the key, for the UI to use its own label.
 */
function fieldParams(
  field: string,
  property: SchemaProperty | undefined,
): FieldParams {
  const title = property?.title;
  if (title && !title.startsWith("$")) return { field, label: title };
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return { field, label: words.charAt(0).toUpperCase() + words.slice(1) };
}

/** A settings problem; `missing` when the setting is only left empty. */
type SettingProblem = ConfigProblem & { missing?: true };

const isEmpty = (value: DataValue) =>
  value === undefined ||
  value === null ||
  (isString(value) && value.trim() === "");

/** The required settings of a node left empty and not wired. */
function missingSettings(
  schema: JsonSchema,
  config: DataRecord,
  wired: ReadonlySet<string>,
): SettingProblem[] {
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = propertiesOf(schema);
  return required
    .filter((field): field is string => typeof field === "string")
    .filter((field) => !wired.has(field) && isEmpty(config[field]))
    .map((field) => {
      const params = fieldParams(field, properties[field]);
      return {
        code: "missingField",
        params,
        message: `${params.label} is empty`,
        missing: true,
      };
    });
}

/** Why a setting's value is refused by its schema: out of bounds or list. */
function invalidSetting(
  field: string,
  property: SchemaProperty,
  value: unknown,
): ConfigProblem | undefined {
  const { minimum, maximum } = property;
  const named = fieldParams(field, property);
  if (isNumber(value) && minimum !== undefined && value < minimum) {
    return {
      code: "belowMinimum",
      params: { ...named, minimum },
      message: `${named.label} must be at least ${minimum}`,
    };
  }
  if (isNumber(value) && maximum !== undefined && value > maximum) {
    return {
      code: "aboveMaximum",
      params: { ...named, maximum },
      message: `${named.label} must be at most ${maximum}`,
    };
  }
  if (property.enum && !property.enum.includes(value)) {
    return {
      code: "notInEnum",
      params: { ...named, value: String(value) },
      message: `${named.label} cannot be ${JSON.stringify(value)}`,
    };
  }
  return undefined;
}

/**
 * The settings of a node its schema refuses: a required one left empty (and
 * not wired), a number out of bounds, a value outside its list.
 */
function settingsProblems(
  node: GraphNode,
  wired: ReadonlySet<string>,
): SettingProblem[] {
  const schema = settingsSchemaOf(node);
  if (!schema) return [];
  const config = node.config ?? {};
  const problems = missingSettings(schema, config, wired);
  const properties = propertiesOf(schema);
  for (const [field, property] of Object.entries(properties)) {
    const value = config[field];
    if (wired.has(field) || isEmpty(value)) continue;
    const problem = invalidSetting(field, property, value);
    if (problem) problems.push(problem);
  }
  return problems;
}

/** What a node needs from the registry and the library to run. */
function typeIssues(
  node: GraphNode,
  reportOn: string,
  options: GraphIssueOptions,
): GraphIssue[] {
  const lookup = TYPE_LOOKUP.get(node.kind);
  if (lookup && !(node.typeId && lookup(node.typeId))) {
    const type = node.typeId ?? "";
    return [
      {
        severity: "error",
        code: "unknownType",
        params: { type },
        message: `${node.kind} node "${node.id}" references unknown type "${type}"`,
        nodeId: reportOn,
      },
    ];
  }
  if (node.typeId && DISABLED_LOOKUP.get(node.kind)?.(node.typeId)) {
    return [
      {
        severity: "warning",
        code: "typeDisabled",
        params: { type: node.typeId },
        message: `type "${node.typeId}" is disabled in the library`,
        nodeId: reportOn,
      },
    ];
  }
  const templateId = isGroupNode(node) ? node.templateId : undefined;
  if (
    templateId !== undefined &&
    options.templates?.has(templateId) === false
  ) {
    return [
      {
        severity: "error",
        code: "unknownTemplate",
        params: { template: templateId },
        message: `template "${templateId}" not found`,
        nodeId: reportOn,
      },
    ];
  }
  return [];
}

/**
 * The settings of every node that keep it from running.
 *
 * A setting left empty is reported once, as missing.
 *
 * An empty setting is only a warning on a draft: the user may still
 * be filling the node in.
 */
function configIssues(
  graph: ProcedureGraph,
  options: GraphIssueOptions,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const { node, level, reportOn } of stepsOf(graph)) {
    issues.push(...typeIssues(node, reportOn, options));
    const wired = new Set(
      level.dataEdges
        .filter((e) => e.to.node === node.id)
        .map((e) => e.to.field),
    );
    const problems = settingsProblems(node, wired);
    const check =
      node.kind === "trigger"
        ? CONFIG_CHECKS.get(node.typeId ?? "")
        : undefined;
    const checked =
      check && !problems.some((p) => p.missing)
        ? check(node.config ?? {})
        : undefined;
    if (checked) problems.push(checked);
    for (const { missing, ...problem } of problems) {
      const severity = missing && !options.enabling ? "warning" : "error";
      issues.push({ severity, ...problem, nodeId: reportOn });
    }
  }
  return issues;
}

/**
 * The number a `forRange` input is set to: typed into the node, or wired
 * from a number constant. Undefined when another node computes it.
 */
function literalInput(
  node: GraphNode,
  level: ProcedureGraph,
  field: string,
): number | undefined {
  const edge = level.dataEdges.find(
    (e) => e.to.node === node.id && e.to.field === field,
  );
  if (!edge)
    return Number(node.config?.[field] ?? FOR_RANGE_DEFAULTS.get(field));
  const source = level.nodes.find((n) => n.id === edge.from.node);
  if (source?.kind !== "data" || source.typeId !== CONSTANT_NUMBER) {
    return undefined;
  }
  return Number(source.config?.value ?? 0);
}

/** Loops set to run more iterations than a run allows. */
function loopIssues(graph: ProcedureGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const { node, level, reportOn } of stepsOf(graph)) {
    if (node.kind !== "forRange") continue;
    const [start, end, step] = ["start", "end", "step"].map((field) =>
      literalInput(node, level, field),
    );
    if (start === undefined || end === undefined || !step) continue;
    const count = Math.ceil((end - start) / step);
    if (!(count > MAX_FOR_RANGE_ITERATIONS)) continue;
    issues.push({
      severity: "warning",
      code: "loopTooLong",
      params: { count, max: MAX_FOR_RANGE_ITERATIONS },
      message: `this loop would run ${count} times, more than the ${MAX_FOR_RANGE_ITERATIONS} a run allows: it will fail`,
      nodeId: reportOn,
    });
  }
  return issues;
}

/** Two webhooks of the same graph on one route: only one would answer. */
function duplicateWebhookIssues(graph: ProcedureGraph): GraphIssue[] {
  const seen = new Set<string>();
  const issues: GraphIssue[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "trigger" || node.typeId !== webhookTrigger.id) continue;
    const { method, path } = webhookRouteOf(node.config);
    const route = `${method} ${path}`;
    if (seen.has(route)) {
      issues.push({
        severity: "error",
        code: "webhookPathDuplicate",
        params: { method, path },
        message: `two webhooks of this procedure answer ${route}`,
        nodeId: node.id,
      });
    }
    seen.add(route);
  }
  return issues;
}

/**
 * Every problem of a graph: the validator's errors and warnings, the types
 * and templates it references, the settings of its nodes, and the steps
 * nothing triggers (a warning). Each carries a code the UI translates and an
 * English message.
 */
export function graphIssues(
  graph: ProcedureGraph,
  options: GraphIssueOptions = {},
): GraphIssue[] {
  const issues = [
    ...graphProblems(graph).map(issueOf),
    ...configIssues(graph, options),
    ...duplicateWebhookIssues(graph),
    ...loopIssues(graph),
  ];
  for (const nodeId of untriggeredSteps(graph)) {
    issues.push({
      severity: "warning",
      code: "untriggered",
      message: "nothing triggers this step, it can never run",
      nodeId,
    });
  }
  if (options.enabling && !hasTrigger(graph)) {
    issues.push({
      severity: "error",
      code: "noTrigger",
      message: "a procedure needs a trigger before it can be enabled",
    });
  }
  return issues;
}

/** Whether a graph has a problem that blocks enabling it. */
export function hasBlockingIssue(issues: readonly GraphIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** Whether a graph has at least one trigger node, nested groups included. */
export function hasTrigger(graph: ProcedureGraph): boolean {
  for (const node of walkNodesRecursive(graph)) {
    if (node.kind === "trigger") return true;
  }
  return false;
}
