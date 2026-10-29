import type { DataNodeType } from "@antelopejs/interface-dms-automation";
import { isBoolean, isNumber, isString } from "../../../types/guards";

const numA = { type: "number", default: 0 };
const numB = { type: "number", default: 0 };
const resultNum = { type: "number" };

/**
 * A math input as a number. Text that reads as a number counts (payload
 * values often are text); anything else fails the node by name rather than
 * computing with NaN, which the run log shows as an empty value.
 */
function operand(id: string, port: string, value: unknown): number {
  const n =
    isString(value) && value.trim() !== ""
      ? Number(value)
      : isNumber(value) || isBoolean(value)
        ? Number(value)
        : Number.NaN;
  if (Number.isNaN(n)) {
    const shown =
      value === null || value === undefined ? "empty" : JSON.stringify(value);
    throw new Error(`${id}: ${port} is not a number (${shown})`);
  }
  return n;
}

/** A result the log can show: NaN and Infinity fail the node instead. */
function finite(
  id: string,
  result: number | null,
  operands: string,
): number | null {
  if (result !== null && !Number.isFinite(result)) {
    throw new Error(
      `${id}: no valid result for ${operands} (too large, or not defined)`,
    );
  }
  return result;
}

function binary(
  id: string,
  icon: string,
  fn: (a: number, b: number) => number | null,
): DataNodeType {
  return {
    id,
    category: "math",
    name: `$dms_automation.types.${id}.name`,
    description: `$dms_automation.types.${id}.description`,
    icon,
    inputSchema: { type: "object", properties: { a: numA, b: numB } },
    outputSchema: { type: "object", properties: { result: resultNum } },
    evaluate: (i: { a: unknown; b: unknown }) => {
      const a = operand(id, "a", i.a);
      const b = operand(id, "b", i.b);
      return { result: finite(id, fn(a, b), `a = ${a}, b = ${b}`) };
    },
  };
}

function unary(
  id: string,
  icon: string,
  fn: (a: number) => number,
): DataNodeType {
  return {
    id,
    category: "math",
    name: `$dms_automation.types.${id}.name`,
    description: `$dms_automation.types.${id}.description`,
    icon,
    inputSchema: { type: "object", properties: { a: numA } },
    outputSchema: { type: "object", properties: { result: resultNum } },
    evaluate: (input: { a: unknown }) => {
      const a = operand(id, "a", input.a);
      return { result: finite(id, fn(a), `a = ${a}`) };
    },
  };
}

/**
 * Division by zero is an expected case (an empty list's average), not an
 * error: it gives null, which the next step can test.
 */
export const mathNodes: DataNodeType[] = [
  binary("math.add", "i-ph-plus", (a, b) => a + b),
  binary("math.subtract", "i-ph-minus", (a, b) => a - b),
  binary("math.multiply", "i-ph-x", (a, b) => a * b),
  binary("math.divide", "i-ph-divide", (a, b) => (b === 0 ? null : a / b)),
  binary("math.modulo", "i-ph-percent", (a, b) => (b === 0 ? null : a % b)),
  binary("math.power", "i-ph-arrow-up-right", Math.pow),
  binary("math.min", "i-ph-caret-down", Math.min),
  binary("math.max", "i-ph-caret-up", Math.max),
  unary("math.negate", "i-ph-arrow-u-down-left", (a) => -a),
  unary("math.abs", "i-ph-equals", Math.abs),
  unary("math.round", "i-ph-circle", Math.round),
  unary("math.floor", "i-ph-arrow-line-down", Math.floor),
  unary("math.ceil", "i-ph-arrow-line-up", Math.ceil),
  unary("math.sqrt", "i-ph-radical", Math.sqrt),
];
