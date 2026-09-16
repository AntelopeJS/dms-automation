import type { DataNodeType } from "@antelopejs/interface-dms-automation";

const objProp = { type: "object", default: {} };
const pathProp = { type: "string", default: "" };
const anyVal = {}; // any
const resultObj = { type: "object" };
const resultArrStr = { type: "array", items: { type: "string" } };
const resultArrAny = { type: "array" };

function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object")
      return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur ?? null;
}

function setPath(
  obj: unknown,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const base =
    obj && typeof obj === "object"
      ? { ...(obj as Record<string, unknown>) }
      : {};
  if (!path) return base;
  const parts = path.split(".");
  let cur: Record<string, unknown> = base;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    const next = cur[k];
    const nextObj =
      next && typeof next === "object"
        ? { ...(next as Record<string, unknown>) }
        : {};
    cur[k] = nextObj;
    cur = nextObj;
  }
  cur[parts[parts.length - 1]!] = value;
  return base;
}

export const objectNodes: DataNodeType[] = [
  {
    id: "object.get",
    category: "object",
    name: "Get",
    description: "read dot-path from object (null on miss)",
    icon: "i-ph-arrow-square-down",
    inputSchema: {
      type: "object",
      properties: { obj: objProp, path: pathProp },
    },
    outputSchema: { type: "object", properties: { result: anyVal } },
    evaluate: (i) => {
      const { obj, path } = i as { obj: unknown; path: string };
      return { result: getPath(obj, String(path ?? "")) };
    },
  },
  {
    id: "object.set",
    category: "object",
    name: "Set",
    description: "immutably set value at dot-path",
    icon: "i-ph-arrow-square-up",
    inputSchema: {
      type: "object",
      properties: { obj: objProp, path: pathProp, value: anyVal },
    },
    outputSchema: { type: "object", properties: { result: resultObj } },
    evaluate: (i) => {
      const { obj, path, value } = i as {
        obj: unknown;
        path: string;
        value: unknown;
      };
      return { result: setPath(obj, String(path ?? ""), value) };
    },
  },
  {
    id: "object.keys",
    category: "object",
    name: "Keys",
    description: "Object.keys(obj)",
    icon: "i-ph-list",
    inputSchema: { type: "object", properties: { obj: objProp } },
    outputSchema: { type: "object", properties: { result: resultArrStr } },
    evaluate: (i) => {
      const { obj } = i as { obj: unknown };
      return {
        result:
          obj && typeof obj === "object" ? Object.keys(obj as object) : [],
      };
    },
  },
  {
    id: "object.values",
    category: "object",
    name: "Values",
    description: "Object.values(obj)",
    icon: "i-ph-list-bullets",
    inputSchema: { type: "object", properties: { obj: objProp } },
    outputSchema: { type: "object", properties: { result: resultArrAny } },
    evaluate: (i) => {
      const { obj } = i as { obj: unknown };
      return {
        result:
          obj && typeof obj === "object" ? Object.values(obj as object) : [],
      };
    },
  },
  {
    id: "object.merge",
    category: "object",
    name: "Merge",
    description: "shallow {...a, ...b}",
    icon: "i-ph-stack",
    inputSchema: { type: "object", properties: { a: objProp, b: objProp } },
    outputSchema: { type: "object", properties: { result: resultObj } },
    evaluate: (i) => {
      const { a, b } = i as { a: unknown; b: unknown };
      const ao =
        a && typeof a === "object" ? (a as Record<string, unknown>) : {};
      const bo =
        b && typeof b === "object" ? (b as Record<string, unknown>) : {};
      return { result: { ...ao, ...bo } };
    },
  },
];
