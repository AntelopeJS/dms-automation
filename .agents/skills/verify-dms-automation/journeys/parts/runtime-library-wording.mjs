/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * @param {string} text Some text
 * @returns {string} The text as a pattern source
 */
function escaped(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Opens a Library tab on the signed-in page and waits until its list shows.
 *
 * @param {Ctx} ctx The journey
 * @param {string} slot The tab's key in the link
 * @param {RegExp} marker Text that only the open tab shows
 * @returns {Promise<import("../../auto.mjs").Tab>} The tab
 */
export async function openLibrary(ctx, slot, marker) {
  const tab = await ctx.tab("admin");
  await tab.signIn("admin");
  await tab.goto(`/modules/automation/library?tab=${slot}`);
  const shown = await tab.shows(marker, { timeoutMs: 20_000 });
  ctx.record(ctx.step(`the Library on ${slot}`), [shown]);
  return tab;
}

/**
 * The checks that the page shows each name followed by its description.
 *
 * @param {import("../../auto.mjs").Tab} tab The tab
 * @param {[string, string][]} entries Name and description
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function showEntries(tab, entries) {
  const checks = [];
  for (const [name, description] of entries) {
    const check = await tab.shows(new RegExp(`${escaped(name)}\\s+${escaped(description)}`), { timeoutMs: 4000 });
    checks.push({ ...check, name: `the Library shows ${name}: ${description}`, detail: check.pass ? "shown" : check.detail.slice(0, 200) });
  }
  return checks;
}

/** @type {[string, string][]} */
export const DATA_ENTRIES = [
  ["Equals", "True when a equals b. A number written as text counts as a number: 5 equals “5”."],
  ["Not equal", "True when a differs from b."],
  ["Less than", "True when a is less than b."],
  ["Greater than", "True when a is greater than b."],
  ["Less or equal", "True when a is less than or equal to b."],
  ["Greater or equal", "True when a is greater than or equal to b."],
  ["Text", "A fixed text."],
  ["Number", "A fixed number."],
  ["True or false", "A fixed true or false value."],
  ["JSON", "A fixed JSON value: an object, a list or a single value."],
  ["Read JSON", "Turns JSON text into a value. Gives an empty value when the text is not valid JSON."],
  ["Write JSON", "Turns a value into JSON text. pretty adds line breaks and indentation."],
  ["And", "True when both a and b are true."],
  ["Or", "True when a, b or both are true."],
  ["Exactly one", "True when exactly one of a and b is true."],
  ["Not", "The opposite of a. The text “false”, “0” and empty text count as false."],
  ["Add", "Adds a and b."],
  ["Subtract", "Subtracts b from a."],
  ["Multiply", "Multiplies a by b."],
  ["Divide", "Divides a by b. Gives an empty value when b is 0."],
  ["Remainder", "The remainder of a divided by b. Gives an empty value when b is 0."],
  ["Power", "a raised to the power of b."],
  ["Minimum", "The smaller of a and b."],
  ["Maximum", "The larger of a and b."],
  ["Negate", "Changes the sign of a."],
  ["Absolute value", "a without its sign."],
  ["Round", "Rounds a to the nearest whole number."],
  ["Round down", "Rounds a down to a whole number."],
  ["Round up", "Rounds a up to a whole number."],
  ["Square root", "The square root of a. Fails when a is negative."],
  ["Get a field", "Reads the field at path in obj, like customer.email. Gives an empty value when it is missing."],
  ["Set a field", "A copy of obj with the field at path set to value. obj itself is not changed."],
  ["Field names", "The list of the field names of obj."],
  ["Field values", "The list of the field values of obj."],
  ["Merge", "The fields of a and b together. When both have a field, b wins."],
  ["Join text", "a followed by b, as text."],
  ["Length", "The number of characters in s. An emoji counts as one."],
  ["Extract", "The characters of s from position start up to end, not included. Positions start at 0."],
  ["Lowercase", "s in lowercase."],
  ["Uppercase", "s in uppercase."],
  ["Trim spaces", "s without the spaces and line breaks at its start and end."],
  ["Split", "Cuts s into a list at each separator (a comma by default)."],
  ["Replace", "s with every occurrence of search replaced by replacement."],
  ["Contains", "True when s contains search."],
];

/** @type {[string, string][]} */
export const FLOW_ENTRIES = [
  ["For range", "Repeats the steps it wraps for each number of a range."],
  ["If", "Goes one way or the other depending on a condition."],
  ["Switch", "Picks the branch whose case matches a value."],
  ["For each", "Repeats the steps it wraps for each item of a list."],
  ["Try / Catch", "Runs the steps it wraps, and other steps if they fail."],
  ["Retry", "Runs the steps it wraps again when they fail, up to a set number of times."],
  ["Parallel", "Starts several branches at once."],
  ["Delay", "Waits for a set time before going on."],
  ["Set variable", "Keeps a value under a name for the next steps."],
];

/** @type {[string, string][]} */
export const ACTION_ENTRIES = [
  ["HTTP request", "Makes an HTTP request. Fails when the status is outside 200–299: wrap it in Retry or Try / catch for flaky endpoints."],
  ["Log", "Writes a message (and an optional value) to the run log"],
];
