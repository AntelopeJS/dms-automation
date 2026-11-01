export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isBigInt(value: unknown): value is bigint {
  return typeof value === "bigint";
}

/** An object or an array, as `typeof` sees it: `null` is not one. */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** What `typeof value === "object"` accepts: an object, an array or `null`. */
export function isObjectOrNull(value: unknown): value is object | null {
  return typeof value === "object";
}

/** A value read by property name: `typeof` "object", not `null`; an array counts. */
export function isPropertyBag(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A value that is not an object: a primitive, a function, `null` or `undefined`. */
export function isPlainScalar(
  value: unknown,
): value is
  | string
  | number
  | boolean
  | bigint
  | symbol
  | ((...args: never[]) => void)
  | null
  | undefined {
  return !isObject(value);
}
