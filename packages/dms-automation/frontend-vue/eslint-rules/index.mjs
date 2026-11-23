/** @typedef {import("vue-eslint-parser").AST.VElement} VElement */
/** @typedef {import("vue-eslint-parser").AST.Token} Token */
/** @typedef {import("vue-eslint-parser").AST.ESLintProgram} ESLintProgram */
/**
 * @typedef {{
 *   defineTemplateBodyVisitor: (
 *     templateVisitor: Record<string, (node: never) => void>,
 *     scriptVisitor?: Record<string, (node: never) => void>,
 *   ) => import("eslint").Rule.RuleListener;
 * }} TemplateServices
 */

const BLANK = /^\s*$/;
const ROW_TOKEN = /\{\{[^}]*\}\}/g;
const BARE_BRACES = /\{[^}]*\}/;

/**
 * @param {unknown} services
 * @returns {services is TemplateServices} Whether the parser provides the template visitor.
 */
function providesTemplateVisitor(services) {
  return (
    typeof services === "object" &&
    services !== null &&
    "defineTemplateBodyVisitor" in services &&
    services.defineTemplateBodyVisitor instanceof Function
  );
}

/**
 * The parser's template visitor, which only vue-eslint-parser provides.
 * @param {import("eslint").Rule.RuleContext} context
 * @returns {TemplateServices["defineTemplateBodyVisitor"] | undefined} The visitor definer, or nothing under another parser.
 */
function templateVisitorOf(context) {
  /** @type {unknown} */
  const services = context.sourceCode.parserServices;
  return providesTemplateVisitor(services)
    ? services.defineTemplateBodyVisitor
    : undefined;
}

/**
 * The end of what precedes `element` in its parent: the previous sibling that
 * is not blank text, or the parent's start tag.
 * @param {VElement} element
 * @returns {number} The offset where what precedes the element ends.
 */
function precedingEnd(element) {
  const { parent } = element;
  const siblings = parent.children;
  const index = siblings.indexOf(element);
  const previous = siblings
    .slice(0, index)
    .reverse()
    .find((node) => !(node.type === "VText" && BLANK.test(node.value)));
  if (previous) return previous.range[1];
  return parent.type === "VElement" ? parent.startTag.range[1] : 0;
}

/**
 * A comment between the branches of a `v-if` chain hydrates with a mismatch:
 * the development compiler moves it into the next branch, which then renders
 * as a fragment, while the server's production compile drops it and renders
 * the bare element.
 * @type {import("eslint").Rule.RuleModule}
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
    const defineTemplateBodyVisitor = templateVisitorOf(context);
    if (!defineTemplateBodyVisitor) return {};
    /** @type {Token[]} */
    let comments = [];
    return defineTemplateBodyVisitor(
      {
        /** @param {VElement} element */
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
            if (
              comment.range[0] >= from &&
              comment.range[1] <= element.range[0]
            )
              context.report({ loc: comment.loc, messageId: "misplaced" });
          }
        },
      },
      {
        /** @param {ESLintProgram} program */
        Program(program) {
          comments = program.templateBody?.comments ?? [];
        },
      },
    );
  },
};

/**
 * The `confirmFrom` call a node makes, if it does.
 * @param {import("estree").CallExpression} node
 * @returns {boolean} Whether the node calls `confirmFrom`.
 */
function isConfirmFromCall(node) {
  const { callee } = node;
  return (
    (callee.type === "Identifier" && callee.name === "confirmFrom") ||
    (callee.type === "MemberExpression" &&
      !callee.computed &&
      (callee.property.type === "Identifier" ||
        callee.property.type === "PrivateIdentifier") &&
      callee.property.name === "confirmFrom")
  );
}

/**
 * The host's `confirmFrom(url, ...)` fills only the `{{row.X}}` tokens of the
 * URL from its `params`. Any other token (`{id}`) reaches the API as it is,
 * `%7Bid%7D`, and the dialog never opens.
 * @type {import("eslint").Rule.RuleModule}
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
    /** @param {import("estree").CallExpression} node */
    const check = (node) => {
      const [url] = node.arguments;
      if (!isConfirmFromCall(node) || url?.type !== "TemplateLiteral") return;
      const text = url.quasis.map((part) => part.value.raw).join("");
      if (BARE_BRACES.test(text.replace(ROW_TOKEN, "")))
        context.report({ node: url, messageId: "bareToken" });
    };
    const defineTemplateBodyVisitor = templateVisitorOf(context);
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
  },
};
