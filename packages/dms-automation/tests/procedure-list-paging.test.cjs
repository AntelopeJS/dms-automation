const assert = require("node:assert/strict");
const { test } = require("node:test");
const fc = require("fast-check");
const { Schema } = require("@antelopejs/interface-database");

/** @type {Array<{ _id: string, name: string, graph: string, updated_at: number }>} */
let storedProcedures = [];
/**
 * @param {"updated_at"} key
 * @param {"asc" | "desc"} direction
 */
const sortedBy = (key, direction) =>
  storedProcedures.toSorted((a, b) =>
    direction === "desc" ? b[key] - a[key] : a[key] - b[key],
  );
const procedureTable = {
  count: () => ({ run: async () => storedProcedures.length }),
  orderBy: (
    /** @type {"updated_at"} */ key,
    /** @type {"asc" | "desc"} */ direction,
  ) => ({
    run: async () => sortedBy(key, direction),
    slice: (/** @type {number} */ offset, /** @type {number} */ count) => ({
      run: async () => sortedBy(key, direction).slice(offset, offset + count),
    }),
  }),
};
Schema.list = () =>
  new Map([
    ["dms_automation", { instance: () => ({ table: () => procedureTable }) }],
  ]);

const { ProceduresController } = require("../dist/routes/procedures.js");
const { Logging } = require("@antelopejs/interface-core/logging");

const GRAPH = {
  nodes: [
    {
      id: "t",
      kind: "trigger",
      typeId: "manual",
      config: {},
      position: { x: 0, y: 0 },
    },
  ],
  triggerEdges: [],
  dataEdges: [],
};

/** The stored forms of a graph the route cannot read: not JSON, a numeric label. */
const UNREADABLE_GRAPHS = [
  "{",
  JSON.stringify({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], label: 5 }] }),
];

/**
 * Stored procedures with distinct update times, each readable or not. The
 * number is the row's update time, so it names the row and fixes the order.
 */
const storedProceduresArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 1_000 }), { maxLength: 30 })
  .chain((times) =>
    fc.tuple(
      ...times.map((time) =>
        fc.constantFrom(
          { time, graph: JSON.stringify(GRAPH) },
          ...UNREADABLE_GRAPHS.map((graph) => ({ time, graph })),
        ),
      ),
    ),
  );

/** @param {string} page @param {number} limit */
const pageOf = async (page, limit) =>
  await ProceduresController.prototype.list.call({}, {}, page, String(limit));

void test("pages of the procedure list return every readable procedure once, newest first, whatever the unreadable rows and the page size", async () => {
  const warn = Logging.Warn;
  Logging.Warn = () => undefined;
  try {
    await fc.assert(
      fc.asyncProperty(
        storedProceduresArb,
        fc.integer({ min: 1, max: 12 }),
        async (rows, limit) => {
          storedProcedures = rows.map(({ time, graph }) => ({
            _id: `p${time}`,
            name: `p${time}`,
            graph,
            updated_at: time,
          }));
          const readableIds = rows
            .filter(({ graph }) => !UNREADABLE_GRAPHS.includes(graph))
            .toSorted((a, b) => b.time - a.time)
            .map(({ time }) => `p${time}`);
          const pageCount = Math.ceil(readableIds.length / limit);

          /** @type {string[]} */
          const read = [];
          for (let page = 0; page <= pageCount; page += 1) {
            const listed = await pageOf(String(page), limit);
            assert.equal(
              listed.total,
              readableIds.length,
              `total, page ${page}`,
            );
            const ids = listed.results.map((p) => p._id);
            assert.equal(
              ids.length,
              page < pageCount - 1
                ? limit
                : page === pageCount - 1
                  ? readableIds.length - page * limit
                  : 0,
              `rows on page ${page}`,
            );
            read.push(...ids);
          }
          assert.deepEqual(read, readableIds);
        },
      ),
      { numRuns: 300 },
    );
  } finally {
    Logging.Warn = warn;
  }
});
