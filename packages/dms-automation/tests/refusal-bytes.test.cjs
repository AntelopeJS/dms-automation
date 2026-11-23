const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const { HTTPResult } = require("@antelopejs/interface-api");
const { parseBody } = require("../dist/routes/requests.js");
const { parseAndValidate } = require("../dist/routes/graphSchema.js");

/** @param {() => unknown} run */
function refusal(run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof HTTPResult);
    return [error.getStatus(), error.getContentType(), error.getBody()];
  }
  return assert.fail("expected a refusal");
}

const schema = z.object({
  kind: z.literal("a").or(z.number()),
  count: z.number().int(),
});

void test("a body zod refuses answers its issues, a union's included, in the bytes the DMS reads", () => {
  assert.deepEqual(
    refusal(() => parseBody(schema, { kind: true, count: 1.5 })),
    [
      400,
      "application/json",
      '{"error":"invalid body","message":"$dms_automation.api.invalidBody","issues":[{"code":"invalid_union","errors":[[{"code":"invalid_value","values":["a"],"path":[],"message":"Invalid input: expected \\"a\\""}],[{"expected":"number","code":"invalid_type","path":[],"message":"Invalid input: expected number, received boolean"}]],"path":["kind"],"message":"Invalid input"},{"expected":"int","format":"safeint","code":"invalid_type","path":["count"],"message":"Invalid input: expected int, received number"}]}',
    ],
  );
});

void test("a graph body zod refuses answers its issues in the same bytes", () => {
  assert.deepEqual(
    refusal(() =>
      parseAndValidate(schema, { kind: true, count: 1.5 }, () => ({
        nodes: [],
        edges: [],
      })),
    ),
    [
      400,
      "application/json",
      '{"error":"invalid body","issues":[{"code":"invalid_union","errors":[[{"code":"invalid_value","values":["a"],"path":[],"message":"Invalid input: expected \\"a\\""}],[{"expected":"number","code":"invalid_type","path":[],"message":"Invalid input: expected number, received boolean"}]],"path":["kind"],"message":"Invalid input"},{"expected":"int","format":"safeint","code":"invalid_type","path":["count"],"message":"Invalid input: expected int, received number"}]}',
    ],
  );
});
