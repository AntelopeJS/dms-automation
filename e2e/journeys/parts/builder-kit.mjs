import { auto, isRow, list, pick, text } from "../../auto.mjs";
import { ariaSnapshot, boundingBox, innerText } from "./overview-page.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Tab} Tab */
/** @typedef {import("../../auto.mjs").Row} Row */

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens the builder on a URL and waits until the page is interactive: the server renders it, and the palette toggle
 * only works once it is hydrated, so it is flipped until it answers and put back.
 *
 * @param {Ctx} ctx The journey
 * @param {string} query What follows `/modules/automation/builder`
 * @param {{ tab?: Tab }} [options] A tab already signed in
 * @returns {Promise<Tab>} The tab
 */
export async function openBuilder(ctx, query, options = {}) {
  const tab = options.tab ?? (await ctx.tab("admin"));
  if (!options.tab) await tab.signIn("admin");
  await tab.goto(`/modules/automation/builder${query}`);
  await tab.visible({ role: "button", name: "Procedures" });
  await settle(tab);
  return tab;
}

/**
 * Waits until the builder reacts to clicks.
 *
 * @param {Tab} tab The tab on the builder
 * @returns {Promise<void>}
 */
export async function settle(tab) {
  const page = tab.page;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const hide = page.getByRole("button", { name: "Hide blocks" });
    const show = page.getByRole("button", { name: "Show blocks" });
    if (await hide.count()) {
      await hide.click();
      if (await show.waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false)) {
        await show.click();
        await hide.waitFor({ state: "visible", timeout: 5000 });
        return;
      }
    } else if (await show.count()) {
      await show.click();
      if (await hide.waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false)) return;
    } else {
      await sleep(500);
    }
  }
}

/**
 * The accessible names of the bar's buttons, left to right.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The names
 */
export async function barButtons(tab) {
  return tab.page.evaluate(() =>
    [...document.querySelectorAll("header button, header [role=button]")]
      .filter((el) => el.closest("header")?.querySelector("input") && el.getAttribute("role") !== "switch")
      .map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
}

/**
 * The text of the bar's save state ("Saved", "1 unsaved change").
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text
 */
export async function saveState(tab) {
  return tab.page.evaluate(() => {
    const bar = [...document.querySelectorAll("header")].find((el) => el.querySelector("input"));
    const span = [...(bar?.querySelectorAll("span") ?? [])].find((el) => /^(Saved|Saving…|\d+ unsaved changes?)$/.test((el.textContent ?? "").trim()));
    return (span?.textContent ?? "").trim();
  });
}

/**
 * Polls until `read` returns a value `done` accepts.
 *
 * @template T
 * @param {() => Promise<T>} read Reads the state
 * @param {(value: T) => boolean} done Whether it is final
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<T>} The last value read
 */
export async function eventually(read, done, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(250);
    value = await read();
  }
  return value;
}

/**
 * The stored procedure.
 *
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<Row>} The procedure with its graph
 */
export async function procedureOf(ctx, id) {
  const answer = await auto(ctx, `read procedure ${id.slice(0, 8)}`, "GET", `/procedures/${id}`);
  return isRow(answer.body) ? answer.body : {};
}

/**
 * The nodes of a stored procedure, as `id kind/typeId` lines, in stored order.
 *
 * @param {Row} procedure The procedure
 * @returns {string[]} The lines
 */
export function nodeLines(procedure) {
  return list(procedure, "graph", "nodes").map((node) => `${text(node, "id")} ${text(node, "kind")}${node.typeId ? `/${text(node, "typeId")}` : ""}`);
}

/**
 * The trigger edges of a stored procedure as `from>to` lines (a branch is `from.branch`).
 *
 * @param {Row} procedure The procedure
 * @returns {string[]} The lines
 */
export function edgeLines(procedure) {
  return list(procedure, "graph", "triggerEdges").map((edge) => {
    const fromBranch = text(edge, "from", "branch");
    const toBranch = text(edge, "to", "branch");
    return `${text(edge, "from", "node")}${fromBranch ? `.${fromBranch}` : ""}>${text(edge, "to", "node")}${toBranch ? `.${toBranch}` : ""}`;
  });
}

/**
 * The data edges of a stored procedure as `node.port>node.field` lines.
 *
 * @param {Row} procedure The procedure
 * @returns {string[]} The lines
 */
export function dataLines(procedure) {
  return list(procedure, "graph", "dataEdges").map((edge) => {
    return `${text(edge, "from", "node")}.${text(edge, "from", "port")}>${text(edge, "to", "node")}.${text(edge, "to", "field")}`;
  });
}

/**
 * Draws a link on the canvas between two handles.
 *
 * @param {Tab} tab The tab on the builder
 * @param {[string, string]} from The node id and the handle id the link starts at
 * @param {[string, string]} to The node id and the handle id it ends at
 * @returns {Promise<void>}
 */
export async function connect(tab, from, to) {
  const page = tab.page;
  const center = async (/** @type {string} */ node, /** @type {string} */ handle) => {
    const box = await boundingBox(page.locator(`.vue-flow__handle[data-nodeid="${node}"][data-handleid="${handle}"]`).first());
    if (!box) throw new Error(`no handle ${handle} on ${node}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const a = await center(...from);
  const b = await center(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await sleep(150);
  await page.mouse.up();
  await sleep(300);
}

/**
 * The ids of the nodes drawn on the canvas.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The ids
 */
export async function canvasNodeIds(tab) {
  return tab.page.evaluate(() => [...document.querySelectorAll(".vue-flow__node")].map((el) => el.getAttribute("data-id") ?? ""));
}

/**
 * Selects a node of the canvas by its id.
 *
 * @param {Tab} tab The tab
 * @param {string} id The node id
 * @param {("Control" | "Shift")[]} [modifiers] Keys held while clicking
 * @returns {Promise<void>}
 */
export async function selectNode(tab, id, modifiers = []) {
  const fit = tab.page.getByRole("button", { name: "Fit view" });
  if (await fit.count()) await fit.click();
  await sleep(350);
  await tab.page.locator(`.vue-flow__node[data-id="${id}"] .truncate`).first().click({ modifiers });
  await sleep(250);
}

/**
 * The text of a bar toast, once one with this title shows.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} All the page's text, for the caller to match
 */
export async function pageText(tab) {
  return innerText(tab.page.locator("body"));
}

/**
 * @param {unknown} body A list answer
 * @param {string} key The field
 * @returns {unknown[]} The values of the field of each row
 */
export function column(body, key) {
  return list(body, "results").map((row) => pick(row, key));
}

/**
 * The palette as the page shows it: groups with their counts, sections and block names, read from the ARIA tree.
 *
 * @param {Tab} tab The tab on the builder
 * @returns {Promise<{ group: string, count: number, sections: { label: string, items: string[] }[] }[]>} The groups in order
 */
export async function paletteOf(tab) {
  const aria = await ariaSnapshot(tab.page.locator("body"));
  const lines = aria.split("\n");
  const start = lines.findIndex((line) => /textbox "Search blocks…"/.test(line));
  const end = lines.findIndex((line) => /Click a block to add it after the selected step|No blocks match/.test(line));
  /** @type {{ group: string, count: number, sections: { label: string, items: string[] }[] }[]} */
  const groups = [];
  for (const raw of lines.slice(start + 1, end === -1 ? undefined : end)) {
    const line = raw.trim().replace(/^- /, "");
    const header = /^text: (Triggers|Actions|Flow|Helpers|Data|Templates) (\d+)(?: (.+))?$/.exec(line);
    if (header) {
      groups.push({ group: header[1], count: Number(header[2]), sections: [{ label: header[3] ?? "", items: [] }] });
      if (header[3] === undefined) groups[groups.length - 1].sections = [{ label: "", items: [] }];
      continue;
    }
    const current = groups.at(-1);
    if (!current) continue;
    const section = /^text: (.+)$/.exec(line);
    if (section) {
      current.sections.push({ label: section[1], items: [] });
      continue;
    }
    const item = /^button "(.*)"$/.exec(line);
    if (item) current.sections.at(-1)?.items.push(item[1]);
  }
  return groups;
}

/**
 * The kinds of a stored procedure's steps in the order its trigger edges lead through them, from the first trigger.
 *
 * @param {Row} procedure The procedure
 * @returns {string[]} `kind[/typeId]` of each step
 */
export function pathOf(procedure) {
  const nodes = list(procedure, "graph", "nodes");
  const edges = list(procedure, "graph", "triggerEdges");
  const byId = new Map(nodes.map((node) => [text(node, "id"), node]));
  const first = nodes.find((node) => node.kind === "trigger");
  const out = [];
  let current = first;
  const seen = new Set();
  while (current && !seen.has(text(current, "id"))) {
    seen.add(text(current, "id"));
    out.push(`${text(current, "kind")}${current.typeId ? `/${text(current, "typeId")}` : ""}`);
    const edge = edges.find((candidate) => pick(candidate, "from", "node") === current?.id);
    current = edge ? byId.get(text(edge, "to", "node")) : undefined;
  }
  return out;
}

/**
 * The same graph with its nodes laid out left to right, so none covers another on the canvas.
 *
 * @param {import("../../procs.mjs").Graph} g The graph
 * @param {number} [gap] The horizontal gap
 * @returns {import("../../procs.mjs").Graph} The laid out graph
 */
export function spread(g, gap = 330) {
  let column = 0;
  let row = 0;
  return {
    ...g,
    nodes: g.nodes.map((node) => {
      if (node.kind === "data") {
        row += 1;
        return { ...node, position: { x: 330 * row, y: 260 } };
      }
      const placed = { ...node, position: { x: column * gap, y: 0 } };
      column += 1;
      return placed;
    }),
  };
}
