import { auto, text } from "../../auto.mjs";
import { action, chain, createProcedure, graph, tedge, trigger } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

export const LIBRARY = "/modules/automation/library";

const POSITION = { x: 0, y: 0 };

/**
 * A group node with a Log action inside, as a local group of a procedure.
 *
 * @param {string} id The node id
 * @param {string} label The group's name
 * @param {string} message The Log message
 * @param {import("../../procs.mjs").GraphNode[]} [extra] More nodes inside the group
 * @returns {import("../../procs.mjs").GraphNode & Record<string, unknown>} The group node
 */
export function localGroup(id, label, message, extra = []) {
  return {
    id,
    kind: "group",
    label,
    config: {},
    position: POSITION,
    ports: [
      { name: "in", kind: "trigger", direction: "in" },
      { name: "out", kind: "trigger", direction: "out" },
    ],
    subgraph: {
      nodes: [
        { id: "gi", kind: "groupInput", config: {}, position: POSITION },
        { id: "go", kind: "groupOutput", config: {}, position: POSITION },
        { id: "inner", kind: "action", typeId: "log.message", config: { message }, position: POSITION },
        ...extra,
      ],
      triggerEdges: [
        { id: "e1", from: { node: "gi", branch: "in" }, to: { node: "inner" } },
        { id: "e2", from: { node: "inner" }, to: { node: "go", branch: "out" } },
      ],
      dataEdges: [],
    },
  };
}

/**
 * A template instance node.
 *
 * @param {string} id The node id
 * @param {string} templateId The template
 * @returns {Record<string, unknown>} The group node
 */
export function instance(id, templateId) {
  return {
    id,
    kind: "group",
    templateId,
    config: {},
    position: POSITION,
    ports: [
      { name: "in", kind: "trigger", direction: "in" },
      { name: "out", kind: "trigger", direction: "out" },
    ],
  };
}

/**
 * Creates a template holding one Log action.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name Its name
 * @returns {Promise<string>} Its id
 */
export async function createTemplate(ctx, name) {
  const inner = localGroup("x", name, "from the template");
  const answer = await auto(ctx, `create template ${name}`, "POST", "/templates", { body: { name, description: "", ports: inner.ports, subgraph: inner.subgraph } });
  return text(answer.body, "_id");
}

/**
 * A procedure with a Manual trigger, a local group holding a Log action, and a template instance, wired in a row.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name Its name
 * @param {string} templateId The template to place
 * @returns {Promise<string>} Its id
 */
export async function procedureWithGroups(ctx, name, templateId) {
  const nodes = [trigger("t"), localGroup("g1", "Notify team", "grouped"), instance("i1", templateId)];
  return createProcedure(ctx, {
    name,
    graph: graph(nodes, [tedge("t", "g1", undefined, "in"), tedge("g1", "i1", "out", "in")]),
  });
}

export { action, chain };
