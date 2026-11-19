/**
 * @param {unknown} value Any value
 * @returns {string[]} The elements as text when it is an array, else none
 */
export function strings(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * The code-unit order `Array.prototype.sort` uses by default, as a comparator.
 *
 * @param {unknown} left A value
 * @param {unknown} right Another value
 * @returns {number} Negative, zero or positive
 */
export function byText(left, right) {
  const a = String(left);
  const b = String(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
