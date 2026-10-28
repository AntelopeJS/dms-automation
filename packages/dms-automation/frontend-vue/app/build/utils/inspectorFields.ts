import type {
  DataNodeType,
  JsonSchema,
  JsonSchemaProperty,
} from "../../composables/useGraphConnect";

export function portsSchema(
  ports: Array<{ name: string; type?: string }>,
): JsonSchema {
  return {
    properties: Object.fromEntries(
      ports.map((p) => [p.name, p.type ? { type: p.type } : {}]),
    ),
  };
}

export function asString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return String(v);
}

export function asNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export function asBool(v: unknown): boolean {
  return !!v;
}

// Returns true if `prop.type` is `"string"` OR an array of scalar types that
// includes `"string"`. Used to render a plain string input instead of a JSON
// textarea for multi-type fields like compare-node ports. A type that also
// takes an object or an array (an HTTP body) keeps the JSON editor, which
// still accepts plain text.
export function isStringish(prop: JsonSchemaProperty): boolean {
  const t = prop.type;
  if (t === "string") return true;
  if (Array.isArray(t))
    return (
      t.includes("string") && !t.includes("object") && !t.includes("array")
    );
  return false;
}

export function isNumberish(prop: JsonSchemaProperty): boolean {
  const t = prop.type;
  if (t === "number" || t === "integer") return true;
  if (
    Array.isArray(t) &&
    (t.includes("number") || t.includes("integer")) &&
    !t.includes("string")
  )
    return true;
  return false;
}

export function isBoolish(prop: JsonSchemaProperty): boolean {
  const t = prop.type;
  if (t === "boolean") return true;
  if (
    Array.isArray(t) &&
    t.includes("boolean") &&
    !t.includes("string") &&
    !t.includes("number")
  )
    return true;
  return false;
}

export function arrayToText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join("\n");
  if (typeof v === "string") return v;
  return "";
}

export function textToArray(s: string): string[] {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * A data node's form: its input schema (wired-port fields) merged with its
 * config schema (in-place config fields, e.g. a constant's value). The config
 * schema wins on key collisions; a node declaring only one schema is unaffected.
 */
export function dataNodeSchema(t: DataNodeType): JsonSchema | null {
  if (!t.configSchema) return t.inputSchema ?? null;
  return {
    type: "object",
    properties: {
      ...(t.inputSchema?.properties ?? {}),
      ...(t.configSchema.properties ?? {}),
    },
    required: [
      ...(t.inputSchema?.required ?? []),
      ...(t.configSchema.required ?? []),
    ],
  };
}

/** A field key in words: "maxAttempts" becomes "Max attempts". */
export function nameInWords(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(
      /\b(id|url)(s?)\b/g,
      (_, word: string, plural: string) => word.toUpperCase() + plural,
    );
  return words.charAt(0).toUpperCase() + words.slice(1);
}
