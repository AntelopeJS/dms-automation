const BLANK = /^\s*$/;
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
  },
};
