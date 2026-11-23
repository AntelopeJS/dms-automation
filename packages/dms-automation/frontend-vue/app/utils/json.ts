/** A JSON value: what a node setting, a payload or a run's inputs hold. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

/** A JSON object. A key may hold `undefined` for a field left unset. */
export type JsonObject = { [key: string]: JsonValue | undefined };

/** What `typeof` calls an object (an array too), `null` aside, read by key. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** A number. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** A JSON array or object: the values that hold others. */
export function isJsonContainer(
  value: JsonValue | undefined,
): value is JsonValue[] | JsonObject {
  return typeof value === "object" && value !== null;
}

/** Whether an optional field is absent or accepted by `accepts`. */
export function isAbsentOr<Value>(
  value: unknown,
  accepts: (candidate: unknown) => candidate is Value,
): value is Value | undefined {
  return value === undefined || accepts(value);
}

/** A scalar that is not the empty string: what a number field converts. */
export function isNonEmptyScalar(
  value: unknown,
): value is string | number | boolean {
  return isScalar(value) && value !== "";
}

/** A string, a number or a boolean: the JSON values a text shows as they are. */
export function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** A list whose every element is a string. */
export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/** A JSON value, checked to its leaves. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return (
    isRecord(value) &&
    Object.values(value).every((v) => v === undefined || isJsonValue(v))
  );
}

/** A deep copy of a JSON value. */
export function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isJsonContainer(value)) return cloneJsonObject(value);
  return value;
}

/** A deep copy of a JSON object, its unset keys kept. */
export function cloneJsonObject(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      entry === undefined ? undefined : cloneJsonValue(entry),
    ]),
  );
}
