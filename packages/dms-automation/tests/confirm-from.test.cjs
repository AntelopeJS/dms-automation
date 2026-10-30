const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { isPropertyBag } = require("../dist/types/guards.js");
const { FRONTEND } = require("./helpers/frontend.cjs");

/**
 * The dialogs the server words are read by the host's `confirmFrom(url, …)`,
 * which fills only the URL's `{{row.X}}` tokens from its `params`: any other
 * token (`{id}`) reaches the API as it is, `%7Bid%7D`, and the dialog never
 * opens.
 */

/** The host's rule (dms-core `interpolateUrl`), for the run below. */
const ROW_TOKEN = /\{\{\s*row\.([^{}\s]+)\s*\}\}/g;

/**
 * @param {string} url
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
const fill = (url, row) =>
  url.replace(ROW_TOKEN, (_, /** @type {string} */ key) =>
    encodeURIComponent(String(row[key])),
  );

void test("re-run asks the dialog of the run it re-runs", async () => {
  /** @type {string[]} */
  const asked = [];
  globalThis.useI18n = () => ({
    t: (/** @type {string} */ key) => key,
  });
  globalThis.useTranslation = () => ({
    processI18n: (/** @type {string} */ value) => value,
  });
  globalThis.useToast = () => ({ add() {} });
  globalThis.useDmsRouter = () => ({ push: async () => {} });
  globalThis.useAuthFetch = () => ({ $authFetch: async () => ({}) });
  globalThis.useConfirmFrom = () => ({
    confirmFrom: async (
      /** @type {string} */ url,
      /** @type {{ params: Record<string, unknown> }} */ options,
    ) => {
      asked.push(fill(url, options.params));
      return false;
    },
  });
  /** @type {unknown} */
  const composable = require(
    path.join(FRONTEND, "app/composables/useRunActions.ts"),
  );
  assert.ok(isPropertyBag(composable));
  const { useRunActions } = composable;

  await useRunActions({
    apiUrl: "/api/automation",
    traceUrl: "/trace",
  }).rerun("run-1", "Welcome mail");

  assert.deepEqual(asked, ["/api/automation/runs/run-1/rerun-confirm"]);
});
