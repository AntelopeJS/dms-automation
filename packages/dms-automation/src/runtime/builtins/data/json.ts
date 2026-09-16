// Same contract as the string nodes: see the note in
// runtime/builtins/data/string.ts.
/* oxlint-disable typescript/no-base-to-string */
import type { DataNodeType } from "@antelopejs/interface-dms-automation";

export const jsonNodes: DataNodeType[] = [
  {
    id: "json.parse",
    category: "json",
    name: "Parse",
    description: "JSON.parse (returns null on error)",
    icon: "i-ph-brackets-curly",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", default: "" } },
    },
    outputSchema: { type: "object", properties: { result: {} } },
    evaluate: (i) => {
      const { text } = i as { text: unknown };
      try {
        return { result: JSON.parse(String(text ?? "")) };
      } catch {
        return { result: null };
      }
    },
  },
  {
    id: "json.stringify",
    category: "json",
    name: "Stringify",
    description: "JSON.stringify (pretty = 2-space indent)",
    icon: "i-ph-code",
    inputSchema: {
      type: "object",
      properties: { value: {}, pretty: { type: "boolean", default: false } },
    },
    outputSchema: {
      type: "object",
      properties: { result: { type: "string" } },
    },
    evaluate: (i) => {
      const { value, pretty } = i as { value: unknown; pretty: boolean };
      return { result: JSON.stringify(value, null, pretty ? 2 : 0) };
    },
  },
];
