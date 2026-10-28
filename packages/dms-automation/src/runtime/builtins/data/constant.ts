import type {
  DataNodeType,
  JsonSchema,
} from "@antelopejs/interface-dms-automation";

/**
 * Constant nodes emit a single value typed into the node — the way to wire a
 * literal (a string, a number, a flag) into a downstream port without an
 * upstream source. The value lives in `configSchema` (edited in the inspector),
 * NOT `inputSchema`, so the node has no data-in port to wire: `inputSchema` is
 * empty. `resolveInputs` merges the node's config, over the schema's default,
 * into the evaluate input, so `value` arrives on `input.value` (the default
 * when the node was saved without one) and is echoed to the `value` port.
 */
function constant(
  id: string,
  icon: string,
  valueSchema: JsonSchema,
): DataNodeType {
  return {
    id,
    category: "constant",
    name: `$dms_automation.types.${id}.name`,
    description: `$dms_automation.types.${id}.description`,
    icon,
    inputSchema: { type: "object", properties: {} },
    configSchema: { type: "object", properties: { value: valueSchema } },
    outputSchema: { type: "object", properties: { value: valueSchema } },
    evaluate: (input) => ({ value: (input as { value: unknown }).value }),
  };
}

/**
 * `default: null` (not an empty schema) so a freshly-dropped, unedited
 * JSON constant emits an explicit null rather than `undefined`.
 */
export const constantNodes: DataNodeType[] = [
  constant("const.string", "i-ph-text-aa", { type: "string", default: "" }),
  constant("const.number", "i-ph-hash", { type: "number", default: 0 }),
  constant("const.boolean", "i-ph-toggle-left", {
    type: "boolean",
    default: false,
  }),
  constant("const.json", "i-ph-brackets-curly", { default: null }),
];
