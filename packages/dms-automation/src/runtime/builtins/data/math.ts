import type { DataNodeType } from "@antelopejs/interface-dms-automation";

const numA = { type: "number", default: 0 };
const numB = { type: "number", default: 0 };
const resultNum = { type: "number" };

function binary(
  id: string,
  name: string,
  description: string,
  icon: string,
  fn: (a: number, b: number) => number | null,
): DataNodeType {
  return {
    id,
    category: "math",
    name,
    description,
    icon,
    inputSchema: { type: "object", properties: { a: numA, b: numB } },
    outputSchema: { type: "object", properties: { result: resultNum } },
    evaluate: (input) => {
      const { a, b } = input as { a: number; b: number };
      return { result: fn(Number(a), Number(b)) };
    },
  };
}

function unary(
  id: string,
  name: string,
  description: string,
  icon: string,
  fn: (a: number) => number,
): DataNodeType {
  return {
    id,
    category: "math",
    name,
    description,
    icon,
    inputSchema: { type: "object", properties: { a: numA } },
    outputSchema: { type: "object", properties: { result: resultNum } },
    evaluate: (input) => {
      const { a } = input as { a: number };
      return { result: fn(Number(a)) };
    },
  };
}

export const mathNodes: DataNodeType[] = [
  binary("math.add", "Add", "a + b", "i-ph-plus", (a, b) => a + b),
  binary("math.subtract", "Subtract", "a - b", "i-ph-minus", (a, b) => a - b),
  binary("math.multiply", "Multiply", "a * b", "i-ph-x", (a, b) => a * b),
  binary(
    "math.divide",
    "Divide",
    "a / b (returns null on div-by-zero)",
    "i-ph-divide",
    (a, b) => (b === 0 ? null : a / b),
  ),
  binary(
    "math.modulo",
    "Modulo",
    "a % b (returns null on div-by-zero)",
    "i-ph-percent",
    (a, b) => (b === 0 ? null : a % b),
  ),
  binary(
    "math.power",
    "Power",
    "a raised to b",
    "i-ph-arrow-up-right",
    Math.pow,
  ),
  binary("math.min", "Min", "minimum of a and b", "i-ph-caret-down", Math.min),
  binary("math.max", "Max", "maximum of a and b", "i-ph-caret-up", Math.max),
  unary("math.negate", "Negate", "-a", "i-ph-arrow-u-down-left", (a) => -a),
  unary("math.abs", "Abs", "|a|", "i-ph-equals", Math.abs),
  unary(
    "math.round",
    "Round",
    "round to nearest integer",
    "i-ph-circle",
    Math.round,
  ),
  unary(
    "math.floor",
    "Floor",
    "round toward -∞",
    "i-ph-arrow-line-down",
    Math.floor,
  ),
  unary(
    "math.ceil",
    "Ceil",
    "round toward +∞",
    "i-ph-arrow-line-up",
    Math.ceil,
  ),
  unary(
    "math.sqrt",
    "Sqrt",
    "square root (NaN if a < 0)",
    "i-ph-radical",
    Math.sqrt,
  ),
];
