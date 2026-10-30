const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  isObject,
  isObjectOrNull,
  isPropertyBag,
  isString,
} = require("../dist/types/guards.js");
const { BuilderPageController } = require("../dist/pages/builder.js");
const { LibraryPageController } = require("../dist/pages/library.js");
const { OverviewPageController } = require("../dist/pages/overview.js");
const { ProceduresPageController } = require("../dist/pages/procedures.js");
const { RunsPageController } = require("../dist/pages/runs.js");
const { TracePageController } = require("../dist/pages/trace.js");

const PAGES = {
  overview: OverviewPageController,
  runs: RunsPageController,
  trace: TracePageController,
  procedures: ProceduresPageController,
  builder: BuilderPageController,
  library: LibraryPageController,
};

const LIVE_PAGES = {
  overview: OverviewPageController,
  runs: RunsPageController,
};

/**
 * A locale file: messages by key, nested by the dots of a message's key.
 * @typedef {{ [key: string]: string | LocaleNode }} LocaleNode
 */

/** @type {LocaleNode[]} */
const LOCALES = [
  require("../frontend-vue/i18n/locales/dms-automation-en-GB.json"),
  require("../frontend-vue/i18n/locales/dms-automation-fr-FR.json"),
];

/** @param {string} key */
function translated(key) {
  return LOCALES.every((messages) => {
    /** @type {unknown} */
    let node = messages;
    for (const part of key.slice(1).split("."))
      node = isPropertyBag(node) ? node[part] : undefined;
    return isString(node) && node.length > 0;
  });
}

/**
 * A field the framework keeps on a page's builders: the tests read these
 * internals, which its types do not show.
 * @param {unknown} node
 * @param {string} key
 */
function field(node, key) {
  assert.ok(isPropertyBag(node), `a component holds ${key}`);
  return node[key];
}

/** @param {unknown} node */
function nameOf(node) {
  const name = field(node, "_componentName");
  assert.ok(isString(name), "a component has a name");
  return name;
}

/**
 * The children of a component, with the ids roles grant them under.
 * @param {unknown} node
 * @returns {{ id: string, component: object }[]}
 */
function childrenOf(node) {
  const children = field(node, "_children") ?? [];
  assert.ok(Array.isArray(children), `${nameOf(node)} has a list of children`);
  return children.map(
    /** @param {unknown} child */
    (child) => {
      assert.ok(isPropertyBag(child), "a child is an object");
      const { id, component } = child;
      assert.ok(isString(id), "a child has an id");
      assert.ok(isObject(component), `${id} holds a component`);
      return { id, component };
    },
  );
}

/**
 * The options a component was given, or nothing for one given none.
 * @param {unknown} node
 */
function optionsOf(node) {
  const options = field(node, "_options");
  if (options === undefined) return undefined;
  assert.ok(isPropertyBag(options), `${nameOf(node)} has options`);
  return options;
}

/** @param {unknown} node */
function requiredOptionsOf(node) {
  const options = optionsOf(node);
  assert.ok(options, `${nameOf(node)} has options`);
  return options;
}

/** Every component a page declares, nested children and modal forms included.
 * @param {object} component
 * @returns {Generator<object>}
 */
function* componentsOf(component) {
  yield component;
  for (const child of childrenOf(component))
    yield* componentsOf(child.component);
}

/**
 * The blocks of a page's body, in the order the page declares them.
 * @param {object} controller
 */
function pageBlocks(controller) {
  return Object.getOwnPropertyNames(controller)
    .map(
      /**
       * @param {string} key
       * @returns {unknown}
       */
      (key) => Object.getOwnPropertyDescriptor(controller, key)?.value,
    )
    .filter(
      /**
       * @param {unknown} value
       * @returns {value is object}
       */
      (value) => isObject(value) && "_componentName" in value,
    );
}

/** @param {object} controller */
function pageComponents(controller) {
  return pageBlocks(controller).flatMap((root) => [...componentsOf(root)]);
}

/**
 * The component of a page named `componentName`.
 * @param {object} controller
 * @param {string} componentName
 */
function componentNamed(controller, componentName) {
  const found = pageComponents(controller).find(
    (c) => nameOf(c) === componentName,
  );
  assert.ok(found, `the page holds a ${componentName}`);
  return found;
}

for (const [file, controller] of Object.entries(PAGES)) {
  void test(`${file}: every custom component reads well in the roles screen`, () => {
    const custom = pageComponents(controller).filter((c) =>
      nameOf(c).startsWith("dms-automation-"),
    );
    for (const component of custom) {
      const metadata = field(component, "metadata");
      assert.ok(isPropertyBag(metadata), `${nameOf(component)} has metadata`);
      const { name: title, description, icon } = metadata;
      assert.ok(isString(title), nameOf(component));
      assert.match(
        title,
        /^\$dms_automation\.permissions\./,
        nameOf(component),
      );
      assert.ok(
        isString(description) && description.startsWith("$dms_automation."),
        nameOf(component),
      );
      assert.ok(icon, nameOf(component));
      assert.ok(translated(title), `${title} is translated`);
      assert.ok(translated(description), `${description} is translated`);
    }
  });
}

/**
 * The `id` child of a component, by the id roles grant it under.
 * @param {object} component
 * @param {string} id
 */
function childOf(component, id) {
  const child = childrenOf(component).find((entry) => entry.id === id);
  assert.ok(child, `${nameOf(component)} has a ${id} child`);
  return child.component;
}

void test("the overview and the run history share one period and its comparison menu", () => {
  const selectors = Object.values(LIVE_PAGES).map((controller) =>
    requiredOptionsOf(childOf(controller.live, "period")),
  );
  for (const options of selectors) {
    assert.equal(options.rememberKey, "automation");
    assert.deepEqual(options.presets, [
      "last-24h",
      "last-7-days",
      "last-30-days",
    ]);
    assert.deepEqual(options.comparisons, ["previous-period", "none"]);
    assert.equal(options.defaultComparison, "previous-period");
    assert.equal(options.comparisonControl, "menu");
    assert.equal(options.rangeLabel, "relative");
    assert.notEqual(options.showRangeLabel, false);
  }
  assert.notEqual(selectors[0].id, selectors[1].id);
});

void test("a year back is offered only when the runs kept reach it", () => {
  const { offeredComparisons } = require("../dist/pages/shared.js");
  const withYear = ["previous-period", "previous-year", "none"];
  const withoutYear = ["previous-period", "none"];
  assert.deepEqual(offeredComparisons(30), withoutYear);
  assert.deepEqual(offeredComparisons(394), withoutYear);
  assert.deepEqual(offeredComparisons(395), withYear);
  assert.deepEqual(offeredComparisons(0), withYear);
});

void test("overview: the runs chart names its compared series in its own legend", () => {
  const card = componentNamed(PAGES.overview, "dms-chart-card");
  const options = requiredOptionsOf(card);
  assert.equal(options.showSeriesLegend, true);
  assert.equal(options.showLegend, false);
  assert.ok(translated("$dms_automation.overview.comparedRuns"));
});

for (const [file, controller] of Object.entries(LIVE_PAGES)) {
  void test(`${file}: every figure of the period shows the comparison its menu picks`, () => {
    const scope = requiredOptionsOf(childOf(controller.live, "period")).id;
    const figures = pageComponents(controller).filter(
      (c) =>
        ["dms-kpi-card", "dms-chart-card"].includes(nameOf(c)) &&
        requiredOptionsOf(c).periodScope === scope,
    );
    assert.equal(figures.length, file === "overview" ? 5 : 4);
    for (const figure of figures) {
      const { showDelta, title } = requiredOptionsOf(figure);
      assert.notEqual(showDelta, false, isString(title) ? title : undefined);
    }
  });
}

void test("overview: each list's skeleton draws the rows its route sends", () => {
  const {
    PROCEDURE_COUNT_LINES,
    RECENT_RUNS,
  } = require("../dist/stats/overview.js");
  const feed = requiredOptionsOf(
    componentNamed(PAGES.overview, "dms-activity-feed-block"),
  );
  assert.equal(feed.maxItems, RECENT_RUNS);
  assert.equal(feed.skeletonCount, RECENT_RUNS);
  const counts = requiredOptionsOf(
    componentNamed(PAGES.overview, "dms-key-value-list-block"),
  );
  assert.equal(counts.skeletonCount, PROCEDURE_COUNT_LINES);
});

void test("overview: the runs chart keeps the line under its total without a comparison", () => {
  const options = requiredOptionsOf(
    componentNamed(PAGES.overview, "dms-chart-card"),
  );
  assert.equal(options.showDelta, true);
  assert.ok(isString(options.description));
  assert.ok(translated(options.description));
});

for (const [file, controller] of Object.entries(LIVE_PAGES)) {
  void test(`${file}: one page toolbar first in the body, keeping the ids roles grant`, () => {
    const blocks = pageBlocks(controller);
    assert.equal(blocks[0], controller.live);
    assert.equal(nameOf(controller.live), "dms-page-toolbar-block");
    assert.deepEqual(
      childrenOf(controller.live).map((child) => child.id),
      ["topics", "toggle", "period"],
    );
    const toggle = childOf(controller.live, "toggle");
    assert.equal(nameOf(toggle), "dms-live-toggle-block");
    assert.equal(requiredOptionsOf(toggle).variant, "pill");
    assert.equal(
      nameOf(childOf(controller.live, "topics")),
      "dms-automation-live-topics",
    );
    assert.ok(!("period" in controller));
  });
}

void test("the live tables hold their rows while paused", () => {
  assert.deepEqual(requiredOptionsOf(PAGES.runs.table).liveHold, {
    whileRowOpen: true,
    whileScrolled: true,
  });
  assert.equal(requiredOptionsOf(PAGES.procedures.table).liveHold, true);
});

void test("every data block of the overview and the run history follows the live topics", () => {
  for (const [file, controller] of Object.entries(LIVE_PAGES)) {
    const topics = requiredOptionsOf(
      childOf(controller.live, "topics"),
    ).realtimeTopic;
    assert.ok(
      (isString(topics) || Array.isArray(topics)) &&
        topics.includes("automation.runs"),
      file,
    );
    const blocks = pageComponents(controller).filter(
      (c) => nameOf(c) !== "dms-automation-live-topics",
    );
    for (const block of blocks) {
      assert.equal(optionsOf(block)?.realtimeTopic, undefined, nameOf(block));
    }
  }
});

void test("procedures: a live-only page toolbar first in the body", () => {
  const controller = PAGES.procedures;
  const blocks = pageBlocks(controller);
  assert.equal(blocks[0], controller.toolbar);
  assert.equal(nameOf(controller.toolbar), "dms-page-toolbar-block");
  assert.deepEqual(
    childrenOf(controller.toolbar).map((child) => child.id),
    ["live"],
  );
});

/**
 * Every message of a locale, by its dotted key.
 * @param {LocaleNode} node
 * @param {string} [prefix]
 * @returns {[string, string][]}
 */
function messagesOf(node, prefix = "") {
  return Object.entries(node).flatMap(([key, value]) =>
    isObjectOrNull(value)
      ? messagesOf(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

void test("both locales say the same things with the same parameters", () => {
  const [en, fr] = LOCALES.map((messages) => new Map(messagesOf(messages)));
  assert.deepEqual(new Set(en.keys()), new Set(fr.keys()));
  /** @param {string} text */
  const params = (text) => new Set(text.match(/\{\w+\}/g));
  for (const [key, text] of en) {
    const translation = fr.get(key);
    assert.ok(isString(translation), key);
    assert.deepEqual(params(translation), params(text), key);
  }
});

void test("no message holds a bare @, which breaks the page", () => {
  for (const messages of LOCALES) {
    for (const [key, text] of messagesOf(messages)) {
      assert.doesNotMatch(text.replaceAll("{'@'}", ""), /@/, key);
    }
  }
});
