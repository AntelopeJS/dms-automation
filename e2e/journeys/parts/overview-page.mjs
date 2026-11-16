import { isText } from "../../auto.mjs";

/**
 * @typedef {import("playwright-core").Locator} Locator
 * @typedef {import("playwright-core").Page} Page
 */

/**
 * @param {Locator} locator A locator
 * @returns {Promise<string>} Its first element's rendered text
 */
export function innerText(locator) {
  return locator.innerText();
}

/**
 * @param {Locator} locator A locator
 * @returns {Promise<string[]>} The rendered text of each element it finds
 */
export function allInnerTexts(locator) {
  return locator.allInnerTexts();
}

/**
 * @param {Locator} locator A locator
 * @returns {Promise<string>} The ARIA snapshot of its element
 */
export function ariaSnapshot(locator) {
  return locator.ariaSnapshot({ timeout: 10_000 });
}

/**
 * @param {Locator} locator A locator
 * @returns {Promise<boolean>} Whether its element is checked
 */
export function isChecked(locator) {
  return locator.isChecked();
}

/**
 * @param {Locator} locator A locator
 * @param {string} selector A selector relative to it
 * @returns {Locator} The locator of the matching descendants
 */
export function within(locator, selector) {
  return locator.locator(selector);
}

/**
 * @param {Locator} locator A locator
 * @param {RegExp} pattern What the elements' text must match
 * @returns {Locator} The matching elements
 */
export function withText(locator, pattern) {
  return locator.filter({ hasText: pattern });
}

/**
 * @param {Locator} locator A locator
 * @param {Locator} other Another locator
 * @returns {Locator} The elements either finds
 */
export function either(locator, other) {
  return locator.or(other);
}

/**
 * @param {import("playwright-core").Download} download A download
 * @returns {string} The file name the page suggested
 */
export function suggestedFilename(download) {
  return download.suggestedFilename();
}

/**
 * @param {Locator} locator A locator
 * @returns {Promise<{ x: number, y: number, width: number, height: number } | null>} Its element's box
 */
export function boundingBox(locator) {
  return locator.boundingBox();
}

/**
 * @param {Locator} locator A locator
 * @param {string} attribute The attribute name
 * @returns {Promise<string[]>} The distinct non-empty values of the attribute across the elements it finds
 */
export async function distinctAttributes(locator, attribute) {
  const found = await locator.evaluateAll((nodes, name) => nodes.map((node) => node.getAttribute(name)), attribute);
  return found.filter(isText).filter((value, index, all) => all.indexOf(value) === index);
}

/**
 * @param {Page} page A page
 * @returns {Promise<string>} Its current HTML
 */
export function pageContent(page) {
  return page.content();
}

/**
 * The order `Array.prototype.sort` gives strings by default, spelled out for lint.
 *
 * @param {string} left One text
 * @param {string} right Another text
 * @returns {number} Negative when `left` sorts first
 */
export function byText(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}
