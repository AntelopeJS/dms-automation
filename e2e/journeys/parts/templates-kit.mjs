import { auto, list, text } from "../../auto.mjs";
import { dedge, graph, tedge, trigger } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */
/** @typedef {{ id: string, kind: string, templateId?: string, typeId?: string, label?: string, config: Row, ports?: Row[], subgraph?: Row, position: { x: number, y: number } }} GroupNode */

/**
 * A group port.
 *
 * @param {string} name The port name
 * @param {"data" | "trigger"} kind The port kind
 * @param {"in" | "out"} direction The direction
 * @param {Row} [schema] The JSON Schema of a data port
 * @returns {Row} The port
 */
export function port(name, kind, direction, schema) {
  return schema ? { name, kind, direction, schema } : { name, kind, direction };
}

/** The ports of the Greeter template: a trigger in and out, a text in, an echo out. */
export const GREETER_PORTS = [
  port("main", "trigger", "in"),
  port("main", "trigger", "out"),
  port("text", "data", "in", { type: "string" }),
  port("echo", "data", "out", { type: "string" }),
];

/**
 * The inside of the Greeter template: a Log of the `text` input, whose `text` is also the `echo` output.
 *
 * @param {string} [level] The Log level
 * @returns {Row} The subgraph
 */
export function greeterSubgraph(level) {
  return {
    nodes: [
      { id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } },
      { id: "log", kind: "action", typeId: "log.message", config: level ? { level } : {}, position: { x: 200, y: 0 } },
      { id: "go", kind: "groupOutput", config: {}, position: { x: 400, y: 0 } },
    ],
    triggerEdges: [
      { id: "e1", from: { node: "gi", branch: "main" }, to: { node: "log" } },
      { id: "e2", from: { node: "log" }, to: { node: "go", branch: "main" } },
    ],
    dataEdges: [
      { id: "d1", from: { node: "gi", port: "text" }, to: { node: "log", field: "message" } },
      { id: "d2", from: { node: "gi", port: "text" }, to: { node: "go", field: "echo" } },
    ],
  };
}

/**
 * A template body.
 *
 * @param {string} name The template name
 * @param {Row} [extra] Fields that replace the Greeter's
 * @returns {Row} The body
 */
export function templateBody(name, extra = {}) {
  return { name, description: "says hi", icon: "i-ph-package", ports: GREETER_PORTS, subgraph: greeterSubgraph(), ...extra };
}

/**
 * Creates a template and reads back its id.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The name
 * @param {Row} [extra] Fields that replace the Greeter's
 * @returns {Promise<string>} The id, empty when refused
 */
export async function createTemplate(ctx, name, extra = {}) {
  const answer = await auto(ctx, `create template ${name}`, "POST", "/templates", { body: templateBody(name, extra) });
  return text(answer.body, "_id");
}

/**
 * A group node placing a template.
 *
 * @param {string} id The node id
 * @param {string} templateId The template
 * @param {Row[]} [ports] The ports the instance declares
 * @param {string} [label] The name the builder gave it
 * @returns {GroupNode} The node
 */
export function instance(id, templateId, ports = GREETER_PORTS, label) {
  return { id, kind: "group", templateId, label, config: {}, ports, position: { x: 200, y: 0 } };
}

/**
 * A local group holding the Greeter inside.
 *
 * @param {string} id The node id
 * @param {string} [label] Its name
 * @param {string} [level] The Log level inside
 * @returns {GroupNode} The node
 */
export function localGroup(id, label, level) {
  return { id, kind: "group", label, config: {}, ports: GREETER_PORTS, subgraph: greeterSubgraph(level), position: { x: 200, y: 0 } };
}

/**
 * A graph with a Manual trigger leading to a Greeter group (instance or local) whose `text` is a constant.
 *
 * @param {GroupNode} group The group node
 * @param {string} [text] The constant fed to `text`
 * @returns {import("../../procs.mjs").Graph} The graph
 */
export function runGroup(group, text = "hello") {
  const constant = { id: "c", kind: "data", typeId: "const.string", config: { value: text }, position: { x: 0, y: 120 } };
  return graph(
    [trigger("t"), constant, group],
    [tedge("t", group.id, undefined, "main")],
    [dedge("c", "value", group.id, "text")],
  );
}

/**
 * The ids of the rows of a list.
 *
 * @param {unknown} body A list answer
 * @returns {string[]} The `_id` of each row of `results`
 */
export function idsOf(body) {
  return list(body, "results").map((row) => text(row, "_id"));
}
