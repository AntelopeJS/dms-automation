import type { DataNodeType } from "@antelopejs/interface-dms-automation";
import { isString } from "../../../types/guards";

const boolProp = { type: "boolean", default: false };
const resultBool = { type: "boolean" };

/** Text that reads as "no": a webhook query string or a form sends it so. */
const FALSE_TEXT = new Set(["", "false", "0"]);

/**
 * A value as a condition. Like JavaScript truthiness, except that the text
 * "false" and "0" are false: values from a query string or a form are text,
 * and `?active=false` must not read as true.
 */
export function toBoolean(value: unknown): boolean {
  if (isString(value)) {
    return !FALSE_TEXT.has(value.trim().toLowerCase());
  }
  return Boolean(value);
}

function bin(
  id: string,
  icon: string,
  fn: (a: boolean, b: boolean) => boolean,
): DataNodeType {
  return {
    id,
    category: "boolean",
    name: `$dms_automation.types.${id}.name`,
    description: `$dms_automation.types.${id}.description`,
    icon,
    inputSchema: { type: "object", properties: { a: boolProp, b: boolProp } },
    outputSchema: { type: "object", properties: { result: resultBool } },
    evaluate: ({ a, b }: { a: unknown; b: unknown }) => {
      return { result: fn(toBoolean(a), toBoolean(b)) };
    },
  };
}

export const booleanNodes: DataNodeType[] = [
  bin("bool.and", "i-ph-intersect-square", (a, b) => a && b),
  bin("bool.or", "i-ph-unite-square", (a, b) => a || b),
  bin("bool.xor", "i-ph-exclude-square", (a, b) => a !== b),
  {
    id: "bool.not",
    category: "boolean",
    name: "$dms_automation.types.bool.not.name",
    description: "$dms_automation.types.bool.not.description",
    icon: "i-ph-exclamation-mark",
    inputSchema: { type: "object", properties: { a: boolProp } },
    outputSchema: { type: "object", properties: { result: resultBool } },
    evaluate: ({ a }: { a: unknown }) => {
      return { result: !toBoolean(a) };
    },
  },
];
