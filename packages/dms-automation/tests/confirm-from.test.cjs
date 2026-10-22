const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { FRONTEND } = require("./frontend.cjs");

// The dialogs the server words are read by the host's `confirmFrom(url, …)`,
// which fills only the URL's `{{row.X}}` tokens from its `params`: any other
// token (`{id}`) reaches the API as it is, `%7Bid%7D`, and the dialog never
// opens.

// The host's rule (dms-core `interpolateUrl`), for the run below.
const ROW_TOKEN = /\{\{\s*row\.([^{}\s]+)\s*\}\}/g;
const fill = (url, row) =>
  url.replace(ROW_TOKEN, (_, key) => encodeURIComponent(String(row[key])));

test("re-run asks the dialog of the run it re-runs", async () => {
  const asked = [];
  globalThis.useI18n = () => ({ t: (key) => key });
  globalThis.useTranslation = () => ({ processI18n: (value) => value });
  globalThis.useToast = () => ({ add() {} });
  globalThis.useDmsRouter = () => ({ push: async () => {} });
  globalThis.useAuthFetch = () => ({ $authFetch: async () => ({}) });
  globalThis.useConfirmFrom = () => ({
    confirmFrom: async (url, options) => {
      asked.push(fill(url, options.params));
      return false;
    },
  });
  const { useRunActions } = require(
    path.join(FRONTEND, "app/composables/useRunActions.ts"),
  );

  await useRunActions({ apiUrl: "/api/automation", traceUrl: "/trace" }).rerun(
    "run-1",
    "Welcome mail",
  );

  assert.deepEqual(asked, ["/api/automation/runs/run-1/rerun-confirm"]);
});

function* sources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(file);
    else if (/\.(ts|vue)$/.test(entry.name)) yield file;
  }
}

test("every confirmFrom URL names its fill-ins as row tokens", () => {
  const offending = [];
  for (const file of sources(path.join(FRONTEND, "app"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const [, url] of source.matchAll(/confirmFrom\(\s*(`[^`]*`)/g)) {
      const bare = url.replace(/\$\{[^}]*\}|\{\{[^}]*\}\}/g, "");
      if (/\{[^}]*\}/.test(bare))
        offending.push(`${path.relative(FRONTEND, file)}: ${url}`);
    }
  }
  assert.deepEqual(offending, []);
});
