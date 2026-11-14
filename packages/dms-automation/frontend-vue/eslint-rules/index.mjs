import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dmsFrontendGlobals from "@antelopejs/dms-frontend/eslint-globals";

const BLANK = /^\s*$/;
const DMS_TAG = /^(?:Dms[A-Z]|dms-[a-z])/;
const COMPONENT_DIR = /(?:^|\/)(?:build\/)?components\//;
const DMS_ALIASES = ["ActivityFeedBlock", "SectionBlock", "FieldRowBlock"];

/** `notice-banner` or `NoticeBanner.vue` as the name Vue resolves: `NoticeBanner`. */
function pascalCase(name) {
  return name
    .replace(/\.vue$/, "")
    .split(/[./_-]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
}

/** The names of the `.vue` files under `root` whose path `keep` accepts. */
function componentFiles(root, keep = () => true) {
  return readdirSync(root, { recursive: true })
    .map((path) => String(path).replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".vue") && keep(path))
    .map((path) => basename(path));
}

/**
 * Every `Dms*` name a template can resolve: the components the installed
 * `@antelopejs/dms` registers under its `Dms` prefix (named as its
 * `dms.frontend.ts` names them), the ones the `@antelopejs/dms-frontend`
 * renderer registers itself, and this module's own, registered under
 * `DmsAutomation`.
 */
function registeredDmsComponents() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dmsRoot = dirname(
    createRequire(import.meta.url).resolve("@antelopejs/dms/package.json"),
  );
  return new Set([
    ...componentFiles(join(dmsRoot, "frontend-vue", "layers"), (path) =>
      COMPONENT_DIR.test(path),
    ).map((file) => `Dms${pascalCase(file)}`),
    ...DMS_ALIASES.map((alias) => `Dms${alias}`),
    ...Object.keys(dmsFrontendGlobals).filter((name) => DMS_TAG.test(name)),
    ...componentFiles(join(here, "..", "app", "components")).map(
      (file) => `DmsAutomation${pascalCase(file)}`,
    ),
  ]);
}

let registered;

/** The names a file imports, which its template may use as tags. */
function importedNames(program) {
  return new Set(
    program.body
      .filter((node) => node.type === "ImportDeclaration")
      .flatMap((node) => node.specifiers.map((spec) => spec.local.name)),
  );
}

/**
 * Vue renders a tag it cannot resolve as an unknown element, with no error:
 * a component the DMS renamed or removed leaves its place empty on screen.
 */
const knownDmsComponents = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unknown:
        "`{{name}}` is no component the installed @antelopejs/dms, @antelopejs/dms-frontend or this module registers, and this file does not import it.",
    },
  },
  create(context) {
    const { defineTemplateBodyVisitor } = context.sourceCode.parserServices;
    if (!defineTemplateBodyVisitor) return {};
    registered ??= registeredDmsComponents();
    const imported = importedNames(context.sourceCode.ast);
    return defineTemplateBodyVisitor({
      VElement(element) {
        const name = element.rawName;
        if (!DMS_TAG.test(name)) return;
        const pascal = pascalCase(name);
        if (registered.has(pascal) || imported.has(name)) return;
        context.report({
          loc: element.startTag.loc,
          messageId: "unknown",
          data: { name },
        });
      },
    });
  },
};
const ROW_TOKEN = /\{\{[^}]*\}\}/g;
const BARE_BRACES = /\{[^}]*\}/;

/**
 * The end of what precedes `element` in its parent: the previous sibling that
 * is not blank text, or the parent's start tag.
 */
function precedingEnd(element) {
  const siblings = element.parent.children;
  const index = siblings.indexOf(element);
  const previous = siblings
    .slice(0, index)
    .reverse()
    .find((node) => !(node.type === "VText" && BLANK.test(node.value)));
  return previous ? previous.range[1] : element.parent.startTag.range[1];
}

/**
 * A comment between the branches of a `v-if` chain hydrates with a mismatch:
 * the development compiler moves it into the next branch, which then renders
 * as a fragment, while the server's production compile drops it and renders
 * the bare element.
 */
const noCommentBeforeElse = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      misplaced:
        "A template comment before `v-else-if` or `v-else` hydrates with a mismatch. Put it inside the branch's element, or into the script.",
    },
  },
  create(context) {
    const { defineTemplateBodyVisitor } = context.sourceCode.parserServices;
    if (!defineTemplateBodyVisitor) return {};
    const comments = context.sourceCode.ast.templateBody?.comments ?? [];
    return defineTemplateBodyVisitor({
      VElement(element) {
        const continues = element.startTag.attributes.some(
          (attribute) =>
            attribute.directive &&
            (attribute.key.name.name === "else" ||
              attribute.key.name.name === "else-if"),
        );
        if (!continues) return;
        const from = precedingEnd(element);
        for (const comment of comments) {
          if (comment.range[0] >= from && comment.range[1] <= element.range[0])
            context.report({ loc: comment.loc, messageId: "misplaced" });
        }
      },
    });
  },
};

/** The `confirmFrom` call a node makes, if it does. */
function isConfirmFromCall(node) {
  const { callee } = node;
  return (
    (callee.type === "Identifier" && callee.name === "confirmFrom") ||
    (callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property.name === "confirmFrom")
  );
}

/**
 * The host's `confirmFrom(url, ...)` fills only the `{{row.X}}` tokens of the
 * URL from its `params`. Any other token (`{id}`) reaches the API as it is,
 * `%7Bid%7D`, and the dialog never opens.
 */
const confirmFromRowTokens = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      bareToken:
        "`confirmFrom` fills only `{{row.X}}` tokens: write the fill-in of this URL as one, or interpolate it.",
    },
  },
  create(context) {
    const check = (node) => {
      const [url] = node.arguments;
      if (!isConfirmFromCall(node) || url?.type !== "TemplateLiteral") return;
      const text = url.quasis.map((part) => part.value.raw).join("");
      if (BARE_BRACES.test(text.replace(ROW_TOKEN, "")))
        context.report({ node: url, messageId: "bareToken" });
    };
    const { defineTemplateBodyVisitor } = context.sourceCode.parserServices;
    const script = { CallExpression: check };
    return defineTemplateBodyVisitor
      ? defineTemplateBodyVisitor(script, script)
      : script;
  },
};

export default {
  rules: {
    "no-comment-before-else": noCommentBeforeElse,
    "confirm-from-row-tokens": confirmFromRowTokens,
    "known-dms-components": knownDmsComponents,
  },
};
