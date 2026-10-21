const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const PAGES = {
  overview: "OverviewPageController",
  runs: "RunsPageController",
  trace: "TracePageController",
  procedures: "ProceduresPageController",
  builder: "BuilderPageController",
  library: "LibraryPageController",
};

const LOCALES = ["en-GB", "fr-FR"].map((locale) =>
  JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../frontend-vue/i18n/locales/dms-automation-${locale}.json`,
      ),
      "utf8",
    ),
  ),
);

function translated(key) {
  return LOCALES.every((messages) => {
    const value = key
      .slice(1)
      .split(".")
      .reduce((node, part) => node?.[part], messages);
    return typeof value === "string" && value.length > 0;
  });
}

/** Every component a page declares, nested children and modal forms included. */
function* componentsOf(component) {
  yield component;
  for (const child of component._children ?? [])
    yield* componentsOf(child.component);
}

/** The blocks of a page's body, in the order the page declares them. */
function pageBlocks(controller) {
  return Object.getOwnPropertyNames(controller)
    .map((key) => controller[key])
    .filter(
      (value) =>
        value && typeof value === "object" && "_componentName" in value,
    );
}

function pageComponents(controller) {
  return pageBlocks(controller).flatMap((root) => [...componentsOf(root)]);
}

for (const [file, name] of Object.entries(PAGES)) {
  test(`${file}: every custom component reads well in the roles screen`, () => {
    const controller = require(`../dist/pages/${file}.js`)[name];
    const custom = pageComponents(controller).filter((c) =>
      c._componentName.startsWith("dms-automation-"),
    );
    for (const component of custom) {
      const { name: title, description, icon } = component.metadata;
      assert.match(
        title,
        /^\$dms_automation\.permissions\./,
        component._componentName,
      );
      assert.ok(
        description?.startsWith("$dms_automation."),
        component._componentName,
      );
      assert.ok(icon, component._componentName);
      assert.ok(translated(title), `${title} is translated`);
      assert.ok(translated(description), `${description} is translated`);
    }
  });
}

/** The `id` child of a component, by the id roles grant it under. */
function childOf(component, id) {
  return component._children.find((child) => child.id === id)?.component;
}

test("the overview and the run history share one period, compared with the one before", () => {
  const selectors = ["overview", "runs"].map((file) => {
    const controller = require(`../dist/pages/${file}.js`)[PAGES[file]];
    return childOf(controller.live, "period")._options;
  });
  for (const options of selectors) {
    assert.equal(options.rememberKey, "automation");
    assert.deepEqual(options.presets, [
      "last-24h",
      "last-7-days",
      "last-30-days",
    ]);
    assert.deepEqual(options.comparisons, ["previous-period"]);
    assert.equal(options.defaultComparison, "previous-period");
    // Said beside the window ("vs …"), with no control of its own.
    assert.equal(options.comparisonControl, "hidden");
    assert.equal(options.rangeLabel, "relative");
    assert.notEqual(options.showRangeLabel, false);
  }
  assert.notEqual(selectors[0].id, selectors[1].id);
});

for (const file of ["overview", "runs"]) {
  test(`${file}: every figure of the period shows the comparison its menu picks`, () => {
    const controller = require(`../dist/pages/${file}.js`)[PAGES[file]];
    const scope = childOf(controller.live, "period")._options.id;
    const figures = pageComponents(controller).filter(
      (c) =>
        ["dms-kpi-card", "dms-chart-card"].includes(c._componentName) &&
        c._options.periodScope === scope,
    );
    // Four KPIs on both pages, and the runs chart on the overview.
    assert.equal(figures.length, file === "overview" ? 5 : 4);
    for (const figure of figures) {
      assert.notEqual(figure._options.showDelta, false, figure._options.title);
    }
  });
}

test("overview: the runs chart names its compared series in its own legend", () => {
  const controller = require("../dist/pages/overview.js")[PAGES.overview];
  const card = pageComponents(controller).find(
    (c) => c._componentName === "dms-chart-card",
  );
  assert.equal(card._options.showSeriesLegend, true);
  // "Period" in one colour would not match the green and red bars.
  assert.equal(card._options.showLegend, false);
  assert.ok(translated("$dms_automation.overview.comparedRuns"));
});

for (const file of ["overview", "runs"]) {
  test(`${file}: one page toolbar first in the body, keeping the ids roles grant`, () => {
    const controller = require(`../dist/pages/${file}.js`)[PAGES[file]];
    const blocks = pageBlocks(controller);
    assert.equal(blocks[0], controller.live);
    assert.equal(controller.live._componentName, "dms-page-toolbar-block");
    assert.deepEqual(
      controller.live._children.map((child) => child.id),
      ["toggle", "topics", "period"],
    );
    const toggle = childOf(controller.live, "toggle");
    assert.equal(toggle._componentName, "dms-live-toggle-block");
    assert.equal(toggle._options.variant, "pill");
    assert.equal(
      childOf(controller.live, "topics")._componentName,
      "dms-automation-live-topics",
    );
    // The period lives in the toolbar now, not in a row of its own.
    assert.equal(controller.period, undefined);
  });
}

test("the live tables hold their rows while paused", () => {
  const runs = require("../dist/pages/runs.js")[PAGES.runs];
  assert.deepEqual(runs.table._options.liveHold, {
    whileRowOpen: true,
    whileScrolled: true,
  });
  const procedures = require("../dist/pages/procedures.js")[PAGES.procedures];
  assert.equal(procedures.table._options.liveHold, true);
});

test("every data block of the overview and the run history follows the live topics", () => {
  // The topics block refreshes every block of the page through the live
  // gate: none needs a topic of its own, which would read it twice.
  for (const file of ["overview", "runs"]) {
    const controller = require(`../dist/pages/${file}.js`)[PAGES[file]];
    const topics = childOf(controller.live, "topics")._options.realtimeTopic;
    assert.ok(topics.includes("automation.runs"), file);
    const blocks = pageComponents(controller).filter(
      (c) => c._componentName !== "dms-automation-live-topics",
    );
    for (const block of blocks) {
      assert.equal(
        block._options?.realtimeTopic,
        undefined,
        block._componentName,
      );
    }
  }
});

test("procedures: a live-only page toolbar first in the body", () => {
  const controller = require("../dist/pages/procedures.js")[PAGES.procedures];
  const blocks = pageBlocks(controller);
  assert.equal(blocks[0], controller.toolbar);
  assert.equal(controller.toolbar._componentName, "dms-page-toolbar-block");
  assert.deepEqual(
    controller.toolbar._children.map((child) => child.id),
    ["live"],
  );
});

/** Every message of a locale, by its dotted key. */
function messagesOf(node, prefix = "") {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "object"
      ? messagesOf(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

test("both locales say the same things with the same parameters", () => {
  const [en, fr] = LOCALES.map((messages) => new Map(messagesOf(messages)));
  assert.deepEqual(new Set(en.keys()), new Set(fr.keys()));
  const params = (text) => new Set(text.match(/\{\w+\}/g));
  for (const [key, text] of en) {
    assert.deepEqual(params(fr.get(key)), params(text), key);
  }
});

test("no message holds a bare @, which breaks the page", () => {
  for (const messages of LOCALES) {
    for (const [key, text] of messagesOf(messages)) {
      assert.doesNotMatch(text.replaceAll("{'@'}", ""), /@/, key);
    }
  }
});
