import type { DataNodeType } from "@antelopejs/interface-dms-automation";

const anyVal = { type: ["number", "string", "boolean", "null"] };
const resultBool = { type: "boolean" };

type CompareMode = "auto" | "number" | "text";

const modeProp = {
  type: "string",
  enum: ["auto", "number", "text"],
  default: "auto",
  description: "$dms_automation.types.compareMode",
};

/** Decimal notation only: "0x10", "0b1" or "Infinity" stay text. */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** The number a value stands for: a number, or text written as a decimal. */
function asNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !DECIMAL.test(value.trim()))
    return undefined;
  return Number(value);
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value as string | number | boolean);
}

function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Kinds `auto` never equates: null, a boolean, anything else. */
function kindRank(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "boolean" ? 1 : 2;
}

/**
 * Where `a` stands against `b`: -1, 0 or 1. `auto` compares two values that
 * read as numbers as numbers (text from a payload or typed in a field
 * included: "10" is greater than "9"), values of the same kind as text, and
 * ranks null before booleans before anything else, so null is never "" and
 * true is never "true".
 */
function order(id: string, a: unknown, b: unknown, mode: CompareMode): number {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (mode === "number") {
    if (na === undefined)
      throw new Error(`${id}: a is not a number (${asText(a)})`);
    if (nb === undefined)
      throw new Error(`${id}: b is not a number (${asText(b)})`);
  }
  if (mode !== "text" && na !== undefined && nb !== undefined) {
    return sign(na - nb);
  }
  if (mode === "auto") {
    const kinds = kindRank(a) - kindRank(b);
    if (kinds !== 0) return sign(kinds);
  }
  return sign(asText(a).localeCompare(asText(b)));
}

function cmp(
  id: string,
  icon: string,
  test: (order: number) => boolean,
): DataNodeType {
  return {
    id,
    category: "compare",
    name: `$dms_automation.types.${id}.name`,
    description: `$dms_automation.types.${id}.description`,
    icon,
    inputSchema: { type: "object", properties: { a: anyVal, b: anyVal } },
    configSchema: { type: "object", properties: { mode: modeProp } },
    outputSchema: { type: "object", properties: { result: resultBool } },
    evaluate: (input) => {
      const { a, b, mode } = input as {
        a: unknown;
        b: unknown;
        mode?: CompareMode;
      };
      return { result: test(order(id, a, b, mode ?? "auto")) };
    },
  };
}

export const compareNodes: DataNodeType[] = [
  cmp("compare.eq", "i-ph-equals", (o) => o === 0),
  cmp("compare.neq", "i-ph-not-equals", (o) => o !== 0),
  cmp("compare.lt", "i-ph-less-than", (o) => o < 0),
  cmp("compare.gt", "i-ph-greater-than", (o) => o > 0),
  cmp("compare.lte", "i-ph-less-than-or-equal", (o) => o <= 0),
  cmp("compare.gte", "i-ph-greater-than-or-equal", (o) => o >= 0),
];
