import type { DataNodeType } from "@antelopejs/interface-dms-automation";

const anyVal = { type: ["number", "string", "boolean", "null"] };
const resultBool = { type: "boolean" };

function cmp(
  id: string,
  name: string,
  description: string,
  icon: string,
  fn: (a: unknown, b: unknown) => boolean,
): DataNodeType {
  return {
    id,
    category: "compare",
    name,
    description,
    icon,
    inputSchema: { type: "object", properties: { a: anyVal, b: anyVal } },
    outputSchema: { type: "object", properties: { result: resultBool } },
    evaluate: (input) => {
      const { a, b } = input as { a: unknown; b: unknown };
      return { result: fn(a, b) };
    },
  };
}

export const compareNodes: DataNodeType[] = [
  cmp(
    "compare.eq",
    "Equals",
    "a === b (strict)",
    "i-ph-equals",
    (a, b) => a === b,
  ),
  cmp(
    "compare.neq",
    "Not equals",
    "a !== b (strict)",
    "i-ph-not-equals",
    (a, b) => a !== b,
  ),
  cmp(
    "compare.lt",
    "Less than",
    "a < b",
    "i-ph-less-than",
    (a, b) => (a as never) < (b as never),
  ),
  cmp(
    "compare.gt",
    "Greater than",
    "a > b",
    "i-ph-greater-than",
    (a, b) => (a as never) > (b as never),
  ),
  cmp(
    "compare.lte",
    "Less or equal",
    "a <= b",
    "i-ph-less-than-or-equal",
    (a, b) => (a as never) <= (b as never),
  ),
  cmp(
    "compare.gte",
    "Greater or equal",
    "a >= b",
    "i-ph-greater-than-or-equal",
    (a, b) => (a as never) >= (b as never),
  ),
];
