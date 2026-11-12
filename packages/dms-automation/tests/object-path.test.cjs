const assert = require("node:assert/strict");
const { test } = require("node:test");
const { builtinDataNodes } = require("../dist/runtime/builtins");
const { registry } = require("../dist/runtime/registry.js");
const { isPropertyBag } = require("../dist/types/guards.js");

for (const d of builtinDataNodes) registry.addDataNode(d.id, d);

/**
 * @param {string} id
 * @param {Record<string, unknown>} inputs
 * @returns {unknown}
 */
function evaluateResult(id, inputs) {
  const dataNode = registry.getDataNode(id);
  assert.ok(dataNode);
  const output = dataNode.evaluate(inputs);
  assert.ok(isPropertyBag(output));
  return output.result;
}

void test("a number or a text path reads the same key", () => {
  assert.equal(evaluateResult("object.get", { obj: [10, 20], path: 1 }), 20);
  assert.equal(evaluateResult("object.get", { obj: [10, 20], path: "1" }), 20);
  assert.deepEqual(
    evaluateResult("object.set", { obj: {}, path: 0, value: "x" }),
    { 0: "x" },
  );
});

void test("a missing path reads the whole object", () => {
  assert.deepEqual(evaluateResult("object.get", { obj: { a: 1 } }), { a: 1 });
  assert.deepEqual(
    evaluateResult("object.get", { obj: { a: 1 }, path: null }),
    { a: 1 },
  );
});

void test("a path that is a list reads as its items joined, an object as its JSON", () => {
  assert.equal(evaluateResult("object.get", { obj: { a: 1 }, path: ["a"] }), 1);
  assert.deepEqual(
    evaluateResult("object.set", { obj: {}, path: ["a"], value: "x" }),
    { a: "x" },
  );
  assert.equal(
    evaluateResult("object.get", {
      obj: { '{"a":1}': 1 },
      path: { a: 1 },
    }),
    1,
  );
});
