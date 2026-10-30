const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Linter } = require("../frontend-vue/node_modules/eslint");
const vueParser = require("../frontend-vue/node_modules/vue-eslint-parser");
const tsParser =
  require("../frontend-vue/node_modules/typescript-eslint/dist/index.js").parser;

/**
 * @param {string} filename
 * @param {string} code
 * @param {string} rule
 */
async function lint(filename, code, rule) {
  const { default: automation } =
    await import("../frontend-vue/eslint-rules/index.mjs");
  const messages = new Linter({ configType: "flat" }).verify(
    code,
    [
      {
        files: ["**/*.vue"],
        languageOptions: {
          parser: vueParser,
          parserOptions: { parser: tsParser },
        },
      },
      { files: ["**/*.ts"], languageOptions: { parser: tsParser } },
      {
        files: ["**/*.{ts,vue}"],
        plugins: { automation },
        rules: { [`automation/${rule}`]: "error" },
      },
    ],
    filename,
  );
  return messages.map(({ line, messageId, message }) => ({
    line,
    message: messageId ?? message,
  }));
}

const vueFile = (template) => `<template>\n${template}\n</template>\n`;

void test("a template comment before v-else-if or v-else is reported where it sits", async () => {
  const found = await lint(
    "Branches.vue",
    vueFile(
      [
        "<div>",
        '<p v-if="a" />',
        "<!-- before else-if -->",
        '<p v-else-if="b" />',
        "<!-- before else -->",
        "<p v-else />",
        "<!-- after the chain -->",
        "<span />",
        "</div>",
      ].join("\n"),
    ),
    "no-comment-before-else",
  );
  assert.deepEqual(
    found.map(({ line }) => line),
    [4, 6],
  );
});

void test("a template comment inside a branch, or ahead of the chain, is accepted", async () => {
  const found = await lint(
    "Branches.vue",
    vueFile(
      [
        "<div>",
        "<!-- ahead of the chain -->",
        '<p v-if="a"><!-- inside --></p>',
        '<p v-else-if="b" />',
        "<p v-else />",
        "</div>",
      ].join("\n"),
    ),
    "no-comment-before-else",
  );
  assert.deepEqual(found, []);
});

void test("a comment before the first branch of a chain nested in another element is accepted", async () => {
  const found = await lint(
    "Branches.vue",
    vueFile(
      [
        '<div v-if="outer">',
        "<!-- first child -->",
        '<p v-if="a" />',
        "<p v-else />",
        "</div>",
        "<div v-else><!-- first child --><p /></div>",
      ].join("\n"),
    ),
    "no-comment-before-else",
  );
  assert.deepEqual(found, []);
});

void test("a confirmFrom URL with a bare token is reported, in a script and in a template", async () => {
  const script = await lint(
    "run.ts",
    "confirmFrom(`/runs/{id}/rerun-confirm`, { params: {} })",
    "confirm-from-row-tokens",
  );
  const member = await lint(
    "run.ts",
    "actions.confirmFrom(`/runs/{id}`, { params: {} })",
    "confirm-from-row-tokens",
  );
  const template = await lint(
    "Run.vue",
    vueFile('<UButton @click="confirmFrom(`/runs/{id}`, { params: {} })" />'),
    "confirm-from-row-tokens",
  );
  assert.deepEqual([script.length, member.length, template.length], [1, 1, 1]);
});

void test("a confirmFrom URL filled by row tokens or interpolation is accepted", async () => {
  const found = await lint(
    "run.ts",
    [
      "confirmFrom(`/runs/{{row._id}}/rerun-confirm`, { params: {} })",
      "confirmFrom(`${base}/runs/{{ row.id }}/{{row.name}}`, { params: {} })",
      'confirmFrom("/runs/rerun-confirm", { params: {} })',
      "other(`/runs/{id}`)",
    ].join("\n"),
    "confirm-from-row-tokens",
  );
  assert.deepEqual(found, []);
});
