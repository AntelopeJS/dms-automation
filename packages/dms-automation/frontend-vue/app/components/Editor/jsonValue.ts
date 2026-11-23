/** A value that survives `JSON.stringify` and `JSON.parse` unchanged. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Whether every nested element and property of `value` is a JSON value. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object":
      return Array.isArray(value)
        ? value.every(isJsonValue)
        : Object.values(value).every(isJsonValue);
    default:
      return false;
  }
}

/** Whether a value is text. */
export function isText(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether a value is a number. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Whether a JSON value is an object, not an array or a scalar. */
export function isJsonObject(
  value: JsonValue | undefined,
): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses JSON text, keeping the text itself when it is not JSON. */
export function parseJsonText(text: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonValue(parsed) ? parsed : text;
  } catch {
    return text;
  }
}

/** Whether a JSON value is an object or an array. */
export function isJsonContainer(
  value: JsonValue | undefined,
): value is JsonValue[] | { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null;
}
