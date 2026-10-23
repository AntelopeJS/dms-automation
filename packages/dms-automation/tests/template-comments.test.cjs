const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { FRONTEND, frontendRequire } = require("./frontend.cjs");

// A template comment between the branches of a `v-if` chain hydrates with a
// mismatch: Vue's development compiler moves it into the next branch, which
// then renders as a fragment, while a production compile (the server's)
// drops it and renders the bare element. Such a comment goes inside the
// branch's element, or into the script.

const { parse } = frontendRequire("vue/compiler-sfc");

const ELEMENT = 1;
const COMMENT = 3;
const DIRECTIVE = 7;

function vueFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return vueFiles(file);
    return entry.name.endsWith(".vue") ? [file] : [];
  });
}

/** Whether `node` continues a `v-if` chain (`v-else-if` or `v-else`). */
function isElseBranch(node) {
  return (
    node?.type === ELEMENT &&
    node.props.some(
      (prop) =>
        prop.type === DIRECTIVE &&
        (prop.name === "else" || prop.name === "else-if"),
    )
  );
}

/** The lines of the comments set right before a `v-else-if` / `v-else`. */
function commentsBeforeElse(node, found = []) {
  const children = node.children ?? [];
  children.forEach((child, index) => {
    if (child.type !== COMMENT) return;
    const next = children.slice(index + 1).find((n) => n.type !== COMMENT);
    if (isElseBranch(next)) found.push(child.loc.start.line);
  });
  for (const child of children) commentsBeforeElse(child, found);
  for (const branch of node.branches ?? []) commentsBeforeElse(branch, found);
  return found;
}

test("no template comment sits between the branches of a v-if chain", () => {
  const offenders = [];
  for (const file of vueFiles(path.join(FRONTEND, "app"))) {
    const source = fs.readFileSync(file, "utf8");
    const { descriptor } = parse(source, { filename: file });
    if (!descriptor.template?.ast) continue;
    for (const line of commentsBeforeElse(descriptor.template.ast))
      offenders.push(
        `${path.relative(FRONTEND, file).replaceAll(path.sep, "/")}:${line}`,
      );
  }
  assert.deepEqual(offenders, []);
});

test("the check finds a comment before a v-else-if or a v-else", () => {
  const { descriptor } = parse(
    [
      "<template><div>",
      '<p v-if="a" />',
      "<!-- before else-if -->",
      '<p v-else-if="b" />',
      "<!-- before else -->",
      "<p v-else />",
      "<!-- after the chain -->",
      "<span />",
      "</div></template>",
    ].join("\n"),
  );
  assert.deepEqual(commentsBeforeElse(descriptor.template.ast), [3, 5]);
});
