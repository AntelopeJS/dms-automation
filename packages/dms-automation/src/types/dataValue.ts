/**
 * A value a node reads or writes: JSON, plus `undefined` for a field that was
 * not set.
 */
export type DataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | DataValue[]
  | { [key: string]: DataValue };

/** The named values of a node's inputs, outputs or config. */
export type DataRecord = { [key: string]: DataValue };

/** A value of the object arm of `DataValue`: not an array, not `null`. */
export function isDataRecord(value: DataValue): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `String(value)` of a node value: a record, which has no text of its own,
 * reads as `[object Object]`, and a list as its items joined by commas.
 */
export function textOf(value: DataValue): string {
  if (isDataRecord(value)) return "[object Object]";
  if (Array.isArray(value)) {
    return value
      .map((item) => (item === null || item === undefined ? "" : textOf(item)))
      .join();
  }
  return String(value);
}

/**
 * Whether `value` is made of strings, numbers, booleans, `null`, `undefined`
 * and arrays and objects of these. A function, a symbol or a bigint is not; an
 * object counts by its own enumerable entries, so a `Date` or a `Map`, which
 * have none, passes: the check is for the output of `JSON.parse`, which never
 * holds one. Iterative, so a deeply nested value cannot overflow the stack.
 */
function isDataValue(value: unknown): value is DataValue {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === null || item === undefined) continue;
    if (Array.isArray(item)) {
      for (const child of item) pending.push(child);
    } else if (typeof item === "object") {
      for (const child of Object.values(item)) pending.push(child);
    } else if (
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    ) {
      return false;
    }
  }
  return true;
}

/** The value a JSON text holds: whatever `JSON.parse` yields is made of the arms of `DataValue`. */
export function parseJsonText(text: string): DataValue {
  const parsed: unknown = JSON.parse(text);
  if (!isDataValue(parsed)) throw new SyntaxError("not a JSON value");
  return parsed;
}
