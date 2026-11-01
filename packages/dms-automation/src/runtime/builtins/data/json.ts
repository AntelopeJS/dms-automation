/* oxlint-disable typescript/no-base-to-string -- String(value) is the contract these nodes were built against; a JSON form changes the output of arrays, dates, errors and cycles. */
import type { DataNodeType } from "@antelopejs/interface-dms-automation";
import { parseJsonText } from "../../../types/dataValue";

export const jsonNodes: DataNodeType[] = [
  {
    id: "json.parse",
    category: "json",
    name: "$dms_automation.types.json.parse.name",
    description: "$dms_automation.types.json.parse.description",
    icon: "i-ph-brackets-curly",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", default: "" } },
    },
    outputSchema: { type: "object", properties: { result: {} } },
    evaluate: ({ text }: { text: unknown }) => {
      try {
        return { result: parseJsonText(String(text ?? "")) };
      } catch {
        return { result: null };
      }
    },
  },
  {
    id: "json.stringify",
    category: "json",
    name: "$dms_automation.types.json.stringify.name",
    description: "$dms_automation.types.json.stringify.description",
    icon: "i-ph-code",
    inputSchema: {
      type: "object",
      properties: { value: {}, pretty: { type: "boolean", default: false } },
    },
    outputSchema: {
      type: "object",
      properties: { result: { type: "string" } },
    },
    evaluate: ({ value, pretty }: { value: unknown; pretty: unknown }) => {
      return { result: JSON.stringify(value, null, pretty ? 2 : 0) };
    },
  },
];
