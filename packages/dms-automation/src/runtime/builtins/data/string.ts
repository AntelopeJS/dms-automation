// `String(value)` is the contract these nodes were built against, not an
// oversight: a stored procedure that wires string.split into string.concat has
// always seen "a,b,c", and a graph that routes on switch.value has always seen
// "[object Object]" for a structured input. Replacing it with a JSON form was
// tried and reverted -- it changed the output of arrays (never "[object
// Object]" to begin with), rendered a Date quoted, collapsed Error, Map and
// RegExp to "{}", and could throw on a cycle inside a workflow run, where
// String() could not. Changing it needs a migration and tests, and this
// repository has neither.
/* oxlint-disable typescript/no-base-to-string */
import type { DataNodeType } from "@antelopejs/interface-dms-automation";

const strProp = { type: "string", default: "" };
const numProp = { type: "number", default: 0 };
const resultStr = { type: "string" };
const resultBool = { type: "boolean" };
const resultNum = { type: "number" };
const resultArr = { type: "array", items: { type: "string" } };

export const stringNodes: DataNodeType[] = [
  {
    id: "string.concat",
    category: "string",
    name: "Concat",
    description: "a + b as strings",
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
    name: "Length",
    description: "character length of s",
    icon: "i-ph-ruler",
    inputSchema: { type: "object", properties: { s: strProp } },
    outputSchema: { type: "object", properties: { result: resultNum } },
    evaluate: (i) => ({
      result: String((i as { s: unknown }).s ?? "").length,
    }),
  },
  {
    id: "string.substring",
    category: "string",
    name: "Substring",
    description: "s.substring(start, end)",
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
        end?: number;
      };
      return {
        result: String(s ?? "").substring(
          Number(start),
          end === undefined ? undefined : Number(end),
        ),
      };
    },
  },
  {
    id: "string.toLowerCase",
    category: "string",
    name: "Lowercase",
    description: "s.toLowerCase()",
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
    name: "Uppercase",
    description: "s.toUpperCase()",
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
    name: "Trim",
    description: "remove surrounding whitespace",
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
    name: "Split",
    description: "s.split(separator)",
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
    name: "Replace",
    description: "replace all occurrences",
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
    name: "Includes",
    description: "s contains search",
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
