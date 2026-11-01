const assert = require("node:assert/strict");
const { test } = require("node:test");
const { isDataValue, parseJsonText } = require("../dist/types/dataValue.js");

void test("a node value holds undefined only as itself or as an unset object key", () => {
  assert.equal(isDataValue(undefined), true);
  assert.equal(isDataValue({ label: "a", unset: undefined }), true);
  assert.equal(isDataValue([1, undefined]), false);
  assert.equal(isDataValue({ items: [undefined] }), false);
});

void test("a JSON text reads as the value it holds", () => {
  assert.deepEqual(
    parseJsonText('{"items":[1,null,"a"],"nested":{"b":true}}'),
    {
      items: [1, null, "a"],
      nested: { b: true },
    },
  );
});
