import type { ProcedureGraph } from "../types/graph";
import { actsForReal } from "./builtins/nodes/action";
import { stepName, stepTitle } from "./describe";
import { flattenGroups } from "./flatten";
import { registry } from "./registry";
import type { TemplateCache } from "./resolveSubgraph";

/**
 * A step a test run executes for real: an action that changes something
 * outside the run (see `ActionType.sideEffects`) and cannot simulate it
 * (`ActionType.dryRun`).
 */
export interface RealEffectStep {
  /** The node, as the executor logs it (`<groupId>__<innerId>` in a group). */
  nodeId: string;
  typeId: string;
  /** The action type's name: an i18n key when the type declares one. */
  typeName: string;
  /**
   * What the builder calls the step, when it differs from its type: its own
   * label, or the group it belongs to inside a template instance.
   */
  label?: string;
}

/**
 * The steps of a graph a test run would execute for real, groups and
 * templates included, in graph order. A graph that cannot be expanded (a
 * template gone) is read as it is: its groups' contents are then unknown.
 */
export function realEffectStepsOf(
  graph: ProcedureGraph,
  templates?: TemplateCache,
): RealEffectStep[] {
  let flat: ProcedureGraph;
  try {
    flat = flattenGroups(graph, templates);
  } catch {
    flat = graph;
  }
  const steps: RealEffectStep[] = [];
  for (const node of flat.nodes) {
    if (node.kind !== "action" || !node.typeId) continue;
    const type = registry.getAction(node.typeId);
    if (!type || !actsForReal(type)) continue;
    const step: RealEffectStep = {
      nodeId: node.id,
      typeId: node.typeId,
      typeName: type.name,
    };
    const name = stepName(graph, node.id);
    const title = name.kind === "action" ? name.label : stepTitle(name);
    if (title && title !== node.id) step.label = title;
    steps.push(step);
  }
  return steps;
}
