import type { DataNodeType } from "@antelopejs/interface-dms-automation";
import { isObject, isPropertyBag } from "../../../types/guards";

const objProp = { type: "object", default: {} };
const pathProp = { type: "string", default: "" };
const anyVal = {};
const resultObj = { type: "object" };
const resultArrStr = { type: "array", items: { type: "string" } };
const resultArrAny = { type: "array" };

/** What defining a plain property takes, where an assignment of `__proto__` would set the prototype. */
const OWN_DATA = { writable: true, enumerable: true, configurable: true };

function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (!isPropertyBag(cur)) {
      return null;
    }
    cur = Object.hasOwn(cur, p) ? cur[p] : undefined;
  }
  return cur ?? null;
}

function setPath(
  obj: unknown,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const base = isPropertyBag(obj) ? { ...obj } : {};
  if (!path) return base;
  const parts = path.split(".");
  let cur: Record<string, unknown> = base;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    const next = Object.hasOwn(cur, k) ? cur[k] : undefined;
    const nextObj = isPropertyBag(next) ? { ...next } : {};
    Object.defineProperty(cur, k, { ...OWN_DATA, value: nextObj });
    cur = nextObj;
  }
  Object.defineProperty(cur, parts[parts.length - 1]!, {
    ...OWN_DATA,
    value,
  });
  return base;
}

export const objectNodes: DataNodeType[] = [
  {
    id: "object.get",
    category: "object",
    name: "$dms_automation.types.object.get.name",
    description: "$dms_automation.types.object.get.description",
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
    name: "$dms_automation.types.object.set.name",
    description: "$dms_automation.types.object.set.description",
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
    name: "$dms_automation.types.object.keys.name",
    description: "$dms_automation.types.object.keys.description",
    icon: "i-ph-list",
    inputSchema: { type: "object", properties: { obj: objProp } },
    outputSchema: { type: "object", properties: { result: resultArrStr } },
    evaluate: ({ obj }: { obj: unknown }) => {
      return {
        result: isObject(obj) ? Object.keys(obj) : [],
      };
    },
  },
  {
    id: "object.values",
    category: "object",
    name: "$dms_automation.types.object.values.name",
    description: "$dms_automation.types.object.values.description",
    icon: "i-ph-list-bullets",
    inputSchema: { type: "object", properties: { obj: objProp } },
    outputSchema: { type: "object", properties: { result: resultArrAny } },
    evaluate: ({ obj }: { obj: unknown }) => {
      return {
        result: isObject(obj) ? Object.values(obj) : [],
      };
    },
  },
  {
    id: "object.merge",
    category: "object",
    name: "$dms_automation.types.object.merge.name",
    description: "$dms_automation.types.object.merge.description",
    icon: "i-ph-stack",
    inputSchema: { type: "object", properties: { a: objProp, b: objProp } },
    outputSchema: { type: "object", properties: { result: resultObj } },
    evaluate: ({ a, b }: { a: unknown; b: unknown }) => {
      const ao = isPropertyBag(a) ? { ...a } : {};
      const bo = isPropertyBag(b) ? { ...b } : {};
      return { result: { ...ao, ...bo } };
    },
  },
];
