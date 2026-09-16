import type { DataNodeType } from "@antelopejs/interface-dms-automation";

const boolProp = { type: "boolean", default: false };
const resultBool = { type: "boolean" };

function bin(
  id: string,
  name: string,
  description: string,
  icon: string,
  fn: (a: boolean, b: boolean) => boolean,
): DataNodeType {
  return {
    id,
    category: "boolean",
    name,
    description,
    icon,
    inputSchema: { type: "object", properties: { a: boolProp, b: boolProp } },
    outputSchema: { type: "object", properties: { result: resultBool } },
    evaluate: (input) => {
      const { a, b } = input as { a: boolean; b: boolean };
      return { result: fn(Boolean(a), Boolean(b)) };
    },
  };
}

export const booleanNodes: DataNodeType[] = [
  bin("bool.and", "And", "a && b", "i-ph-intersect-square", (a, b) => a && b),
  bin("bool.or", "Or", "a || b", "i-ph-unite-square", (a, b) => a || b),
  bin(
    "bool.xor",
    "Xor",
    "exactly one of a, b",
    "i-ph-exclude-square",
    (a, b) => a !== b,
  ),
  {
    id: "bool.not",
    category: "boolean",
    name: "Not",
    description: "!a",
    icon: "i-ph-exclamation-mark",
    inputSchema: { type: "object", properties: { a: boolProp } },
    outputSchema: { type: "object", properties: { result: resultBool } },
    evaluate: (input) => {
      const { a } = input as { a: boolean };
      return { result: !a };
    },
  },
];
