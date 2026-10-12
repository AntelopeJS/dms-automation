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

function pageComponents(controller) {
  return Object.getOwnPropertyNames(controller)
    .map((key) => controller[key])
    .filter(
      (value) =>
        value && typeof value === "object" && "_componentName" in value,
    )
    .flatMap((root) => [...componentsOf(root)]);
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

test("the module's pages are DMS blocks around a few custom components", () => {
  const counts = Object.entries(PAGES).map(([file, name]) => {
    const all = pageComponents(require(`../dist/pages/${file}.js`)[name]);
    return all.filter((c) => c._componentName.startsWith("dms-automation-"))
      .length;
  });
  // overview: the attention list and the live topics relay (the health line is
  // a DMS banner); runs: the live topics relay (the drawer is a row action);
  // trace: the trace; procedures: none; builder: the editor; library: four
  // catalogs and the templates.
  assert.deepEqual(counts, [2, 1, 1, 0, 1, 5]);
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
