import type {
  JsonObject,
  JsonValue,
} from "@antelopejs/interface-dms-automation";
import { isBoolean, isNumber, isObject, isString } from "./guards";

/**
 * A value a node reads or writes: JSON, plus `undefined` for a field that was
 * not set.
 */
export type DataValue = JsonValue | undefined;

/** The named values of a node's inputs, outputs or config. */
export type DataRecord = JsonObject;

/** A value of the object arm of `DataValue`: not an array, not `null`. */
export function isDataRecord(value: DataValue): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `value` is made of strings, numbers, booleans, `null`, and arrays
 * and objects of these, `undefined` standing only for the whole value or for
 * an object key left unset. A function, a symbol, a bigint or an array item
 * holding `undefined` is not; an object counts by its own enumerable entries,
 * so a `Date` or a `Map`, which have none, passes: the check is for the
 * output of `JSON.parse`, which never holds one. Iterative, so a deeply
 * nested value cannot overflow the stack, and each object is read once, so a
 * cycle ends the walk.
 */
export function isDataValue(value: unknown): value is DataValue {
  const pending: unknown[] = [value];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === null || item === undefined) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.includes(undefined)) return false;
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

/**
 * The arm of `DataValue` a value is, named as `typeof` names it: `null` and
 * an array are "object".
 */
export function kindOf(
  value: DataValue,
): "string" | "number" | "boolean" | "object" | "undefined" {
  if (value === undefined) return "undefined";
  if (isString(value)) return "string";
  if (isNumber(value)) return "number";
  if (isBoolean(value)) return "boolean";
  return "object";
}

/** A value that reads as text through its own `toString`. */
interface Textual {
  toString(): string;
}

/**
 * Whether `value` gets its text from a `toString` other than `Object`'s, as a
 * `Date` or a database id handed in by a module's action does: the first
 * prototype up its chain that holds a `toString` is not `Object.prototype`. A
 * key of its own named `toString`, which JSON can hold, does not count.
 */
function hasOwnText(value: DataRecord): boolean {
  let owner: unknown = Object.getPrototypeOf(value);
  while (isObject(owner) && !Object.hasOwn(owner, "toString")) {
    owner = Object.getPrototypeOf(owner);
  }
  return isObject(owner) && owner !== Object.prototype;
}

/**
 * A value as text. A string, number, boolean, `null` or `undefined` reads as
 * `String` reads it. An array reads as its items, each read this way, joined
 * with commas, `null` and `undefined` as nothing, as `join` does. An object
 * with a `toString` of its own, a `Date` or a database id, reads as `String`
 * reads it; any other object as its JSON.
 */
export function textOf(value: DataValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => textOf(item ?? "")).join(",");
  }
  if (isDataRecord(value)) {
    if (hasOwnText(value)) {
      const textual: Textual = value;
      return textual.toString();
    }
    const json: string | undefined = JSON.stringify(value);
    return json ?? "";
  }
  return String(value);
}

/**
 * A node input as `String` reads it, or `absent` when it is `null` or
 * `undefined`: what the string and JSON nodes read their inputs as.
 */
export function inputText(value: unknown, absent = ""): string {
  const text = String(value);
  return value === null || value === undefined ? absent : text;
}

/** The value a JSON text holds: whatever `JSON.parse` yields is made of the arms of `DataValue`. */
export function parseJsonText(text: string): DataValue {
  const parsed: unknown = JSON.parse(text);
  if (!isDataValue(parsed)) throw new SyntaxError("not a JSON value");
  return parsed;
}
