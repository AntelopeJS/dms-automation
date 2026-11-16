import { auto, isRow, list } from "../../auto.mjs";
import { instance, port } from "./templates-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const pause = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {Ctx} ctx The journey
 * @param {string} id A template
 * @returns {Promise<import("../../auto.mjs").Answer>} The template
 */
export const readTemplate = (ctx, id) => auto(ctx, `read template ${id.slice(0, 8)}`, "GET", `/templates/${id}`);

/**
 * @param {Ctx} ctx The journey
 * @param {string} id A procedure
 * @returns {Promise<Row>} The procedure with its graph
 */
export async function readProcedure(ctx, id) {
  const answer = await auto(ctx, `read procedure ${id.slice(0, 8)}`, "GET", `/procedures/${id}`);
  return isRow(answer.body) ? answer.body : {};
}

/**
 * The node of a stored procedure graph.
 *
 * @param {Row} procedure The procedure
 * @param {string} nodeId The node
 * @returns {Row} The node, empty when missing
 */
export function nodeOf(procedure, nodeId) {
  return list(procedure, "graph", "nodes").find((node) => node.id === nodeId) ?? {};
}

/**
 * A template whose subgraph places another template once.
 *
 * @param {string} innerId The placed template
 * @returns {Row} The subgraph
 */
export function nestingSubgraph(innerId) {
  return {
    nodes: [
      { id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } },
      instance("inner", innerId),
      { id: "go", kind: "groupOutput", config: {}, position: { x: 400, y: 0 } },
    ],
    triggerEdges: [
      { id: "n1", from: { node: "gi", branch: "main" }, to: { node: "inner", branch: "main" } },
      { id: "n2", from: { node: "inner", branch: "main" }, to: { node: "go", branch: "main" } },
    ],
    dataEdges: [
      { id: "n3", from: { node: "gi", port: "text" }, to: { node: "inner", field: "text" } },
      { id: "n4", from: { node: "inner", port: "echo" }, to: { node: "go", field: "echo" } },
    ],
  };
}

/**
 * Local groups nested `depth` levels deep, each holding the next.
 *
 * @param {number} depth How many groups are nested
 * @returns {Row} A template subgraph
 */
export function nestedGroups(depth) {
  /** @type {Row} */
  let inner = { nodes: [{ id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } }, { id: "go", kind: "groupOutput", config: {}, position: { x: 400, y: 0 } }], triggerEdges: [], dataEdges: [] };
  for (let level = depth; level >= 1; level -= 1) {
    inner = {
      nodes: [
        { id: "gi", kind: "groupInput", config: {}, position: { x: 0, y: 0 } },
        { id: `g${level}`, kind: "group", config: {}, ports: [port("main", "trigger", "in")], subgraph: inner, position: { x: 200, y: 0 } },
        { id: "go", kind: "groupOutput", config: {}, position: { x: 400, y: 0 } },
      ],
      triggerEdges: [],
      dataEdges: [],
    };
  }
  return inner;
}
