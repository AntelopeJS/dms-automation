/* oxlint-disable typescript/no-base-to-string -- String(value) is the contract these nodes were built against; a JSON form changes the output of arrays, dates, errors and cycles. */
import type { DataNodeType } from "@antelopejs/interface-dms-automation";

const strProp = { type: "string", default: "" };
const numProp = { type: "number", default: 0 };
const resultStr = { type: "string" };
const resultBool = { type: "boolean" };
const resultNum = { type: "number" };
const resultArr = { type: "array", items: { type: "string" } };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The characters of `s` as a reader counts them: an emoji or an accented
 * letter is one character, where `s.length` counts UTF-16 code units and
 * `substring` can cut one in half.
 */
function characters(s: string): string[] {
  return Array.from(graphemes.segment(s), (g) => g.segment);
}

/** `substring` semantics (clamped, swapped when reversed) over characters. */
function slice(s: string, start: number, end: number | undefined): string {
  const chars = characters(s);
  const clamp = (n: number): number =>
    Number.isNaN(n) ? 0 : Math.min(Math.max(Math.trunc(n), 0), chars.length);
  const from = clamp(start);
  const to = end === undefined ? chars.length : clamp(end);
  return chars.slice(Math.min(from, to), Math.max(from, to)).join("");
}

export const stringNodes: DataNodeType[] = [
  {
    id: "string.concat",
    category: "string",
    name: "$dms_automation.types.string.concat.name",
    description: "$dms_automation.types.string.concat.description",
    icon: "i-ph-text-aa",
    inputSchema: { type: "object", properties: { a: strProp, b: strProp } },
    outputSchema: { type: "object", properties: { result: resultStr } },
    evaluate: (i) => {
      const { a, b } = i as { a: unknown; b: unknown };
      return { result: String(a ?? "") + String(b ?? "") };
    },
  },
  {
    id: "string.length",
    category: "string",
    name: "$dms_automation.types.string.length.name",
    description: "$dms_automation.types.string.length.description",
    icon: "i-ph-ruler",
    inputSchema: { type: "object", properties: { s: strProp } },
    outputSchema: { type: "object", properties: { result: resultNum } },
    evaluate: (i) => ({
      result: characters(String((i as { s: unknown }).s ?? "")).length,
    }),
  },
  {
    id: "string.substring",
    category: "string",
    name: "$dms_automation.types.string.substring.name",
    description: "$dms_automation.types.string.substring.description",
    icon: "i-ph-text-columns",
    inputSchema: {
      type: "object",
      properties: { s: strProp, start: numProp, end: { type: "number" } },
    },
    outputSchema: { type: "object", properties: { result: resultStr } },
    evaluate: (i) => {
      const { s, start, end } = i as {
        s: unknown;
        start: number;
        end?: number | null;
      };
      return {
        result: slice(
          String(s ?? ""),
          Number(start),
          end === undefined || end === null ? undefined : Number(end),
        ),
      };
    },
  },
  {
    id: "string.toLowerCase",
    category: "string",
    name: "$dms_automation.types.string.toLowerCase.name",
    description: "$dms_automation.types.string.toLowerCase.description",
    icon: "i-ph-text-aa",
    inputSchema: { type: "object", properties: { s: strProp } },
    outputSchema: { type: "object", properties: { result: resultStr } },
    evaluate: (i) => ({
      result: String((i as { s: unknown }).s ?? "").toLowerCase(),
    }),
  },
  {
    id: "string.toUpperCase",
    category: "string",
    name: "$dms_automation.types.string.toUpperCase.name",
    description: "$dms_automation.types.string.toUpperCase.description",
    icon: "i-ph-text-aa",
    inputSchema: { type: "object", properties: { s: strProp } },
    outputSchema: { type: "object", properties: { result: resultStr } },
    evaluate: (i) => ({
      result: String((i as { s: unknown }).s ?? "").toUpperCase(),
    }),
  },
  {
    id: "string.trim",
    category: "string",
    name: "$dms_automation.types.string.trim.name",
    description: "$dms_automation.types.string.trim.description",
    icon: "i-ph-broom",
    inputSchema: { type: "object", properties: { s: strProp } },
    outputSchema: { type: "object", properties: { result: resultStr } },
    evaluate: (i) => ({
      result: String((i as { s: unknown }).s ?? "").trim(),
    }),
  },
  {
    id: "string.split",
    category: "string",
    name: "$dms_automation.types.string.split.name",
    description: "$dms_automation.types.string.split.description",
    icon: "i-ph-scissors",
    inputSchema: {
      type: "object",
      properties: { s: strProp, separator: { type: "string", default: "," } },
    },
    outputSchema: { type: "object", properties: { result: resultArr } },
    evaluate: (i) => {
      const { s, separator } = i as { s: unknown; separator: string };
      return { result: String(s ?? "").split(String(separator ?? ",")) };
    },
  },
  {
    id: "string.replace",
    category: "string",
    name: "$dms_automation.types.string.replace.name",
    description: "$dms_automation.types.string.replace.description",
    icon: "i-ph-pencil-simple",
    inputSchema: {
      type: "object",
      properties: { s: strProp, search: strProp, replacement: strProp },
    },
    outputSchema: { type: "object", properties: { result: resultStr } },
    evaluate: (i) => {
      const { s, search, replacement } = i as {
        s: unknown;
        search: string;
        replacement: string;
      };
      return {
        result: String(s ?? "")
          .split(String(search ?? ""))
          .join(String(replacement ?? "")),
      };
    },
  },
  {
    id: "string.includes",
    category: "string",
    name: "$dms_automation.types.string.includes.name",
    description: "$dms_automation.types.string.includes.description",
    icon: "i-ph-magnifying-glass",
    inputSchema: {
      type: "object",
      properties: { s: strProp, search: strProp },
    },
    outputSchema: { type: "object", properties: { result: resultBool } },
    evaluate: (i) => {
      const { s, search } = i as { s: unknown; search: string };
      return { result: String(s ?? "").includes(String(search ?? "")) };
    },
  },
];
