import { isFunction, isText } from "../../auto.mjs";

/**
 * The reads of a Playwright locator and page that `playwright-core.d.ts` does not declare.
 *
 * @typedef {import("playwright-core").Locator} Locator
 * @typedef {import("playwright-core").Page} Page
 * @typedef {{ getAttribute: (name: string) => string | null }} Node
 * @typedef {Locator & {
 *   innerText: () => Promise<string>,
 *   allInnerTexts: () => Promise<string[]>,
 *   ariaSnapshot: (options: { timeout: number }) => Promise<string>,
 *   isChecked: () => Promise<boolean>,
 *   boundingBox: () => Promise<{ x: number, y: number, width: number, height: number } | null>,
 *   evaluateAll: (read: (nodes: Node[], attribute: string) => (string | null)[], attribute: string) => Promise<(string | null)[]>,
 *   locator: (selector: string) => Locator,
 *   filter: (options: { hasText: RegExp }) => Locator,
 *   or: (other: Locator) => Locator,
 * }} FullLocator
 * @typedef {Page & { content: () => Promise<string> }} FullPage
 */

/**
 * @param {Locator} locator A locator
 * @returns {locator is FullLocator} Whether it carries every read of the full Playwright locator
 */
function isFull(locator) {
  return (
    "innerText" in locator &&
    isFunction(locator.innerText) &&
    "allInnerTexts" in locator &&
    isFunction(locator.allInnerTexts) &&
    "ariaSnapshot" in locator &&
    isFunction(locator.ariaSnapshot) &&
    "isChecked" in locator &&
    isFunction(locator.isChecked) &&
    "boundingBox" in locator &&
    isFunction(locator.boundingBox) &&
    "evaluateAll" in locator &&
    isFunction(locator.evaluateAll) &&
    "locator" in locator &&
    isFunction(locator.locator) &&
    "filter" in locator &&
    isFunction(locator.filter) &&
    "or" in locator &&
    isFunction(locator.or)
  );
}

/**
 * @param {Locator} locator A locator
 * @returns {FullLocator} The same locator, known to carry every read
 */
function full(locator) {
  if (!isFull(locator)) throw new Error("the locator lacks the Playwright reads");
  return locator;
}

/**
 * @param {Locator} locator A locator
 * @returns {Promise<string>} Its first element's rendered text
 */
export function innerText(locator) {
  return full(locator).innerText();
}

/**
 * @param {Locator} locator A locator
 * @returns {Promise<string[]>} The rendered text of each element it finds
 */
export function allInnerTexts(locator) {
  return full(locator).allInnerTexts();
}

/**
 * @param {Locator} locator A locator
 * @returns {Promise<string>} The ARIA snapshot of its element
 */
export function ariaSnapshot(locator) {
  return full(locator).ariaSnapshot({ timeout: 10_000 });
}

/**
 * @param {Locator} locator A locator
 * @returns {Promise<boolean>} Whether its element is checked
 */
export function isChecked(locator) {
  return full(locator).isChecked();
}

/**
 * @param {Locator} locator A locator
 * @param {string} selector A selector relative to it
 * @returns {Locator} The locator of the matching descendants
 */
export function within(locator, selector) {
  return full(locator).locator(selector);
}

/**
 * @param {Locator} locator A locator
 * @param {RegExp} pattern What the elements' text must match
 * @returns {Locator} The matching elements
 */
export function withText(locator, pattern) {
  return full(locator).filter({ hasText: pattern });
}

/**
 * @param {Locator} locator A locator
 * @param {Locator} other Another locator
 * @returns {Locator} The elements either finds
 */
export function either(locator, other) {
  return full(locator).or(other);
}

/**
 * @param {import("playwright-core").Download} download A download
 * @returns {string} The file name the page suggested
 */
export function suggestedFilename(download) {
  if (!("suggestedFilename" in download) || !isFunction(download.suggestedFilename)) throw new Error("the download lacks suggestedFilename()");
  const name = download.suggestedFilename();
  return isText(name) ? name : "";
}

/**
 * @param {Locator} locator A locator
 * @returns {Promise<{ x: number, y: number, width: number, height: number } | null>} Its element's box
 */
export function boundingBox(locator) {
  return full(locator).boundingBox();
}

/**
 * @param {Locator} locator A locator
 * @param {string} attribute The attribute name
 * @returns {Promise<string[]>} The distinct non-empty values of the attribute across the elements it finds
 */
export async function distinctAttributes(locator, attribute) {
  const found = await full(locator).evaluateAll((nodes, name) => nodes.map((node) => node.getAttribute(name)), attribute);
  return found.filter(isText).filter((value, index, all) => all.indexOf(value) === index);
}

/**
 * @param {Page} page A page
 * @returns {Promise<string>} Its current HTML
 */
export async function pageContent(page) {
  if (!("content" in page) || !isFunction(page.content)) throw new Error("the page lacks content()");
  const html = await page.content();
  return isText(html) ? html : "";
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
