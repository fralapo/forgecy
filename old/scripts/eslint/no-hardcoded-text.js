// @ts-check
/**
 * Interface text comes from packages/i18n/messages, never from JSX: this rule reports
 * words written directly in markup or in text props (title, label, placeholder, aria-*...).
 * Strings without letters ("—", "·", "→") and whitespace pass.
 */

const LETTER = /\p{L}/u;
const TEXT_PROPS =
  /^(alt|title|placeholder|label|description|summary|caption|heading|hint|message|text|aria-label|aria-description|aria-placeholder|aria-valuetext|aria-roledescription)$|(Label|Text|Title|Description|Placeholder|Message|Hint)$/;

/** @param {string} value */
const hasWords = (value) => LETTER.test(value);

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow hardcoded interface text; use next-intl messages." },
    schema: [],
    messages: {
      text: 'Hardcoded interface text "{{text}}": move it to packages/i18n/messages and use t().',
    },
  },
  create(context) {
    /**
     * @param {import("estree").Node} node
     * @param {string} text
     */
    const report = (node, text) =>
      context.report({ node, messageId: "text", data: { text: text.trim().slice(0, 40) } });

    /** @param {any} expr */
    const checkExpression = (expr) => {
      if (!expr) return;
      if (expr.type === "Literal" && typeof expr.value === "string" && hasWords(expr.value))
        report(expr, expr.value);
      if (expr.type === "TemplateLiteral")
        for (const q of expr.quasis) if (hasWords(q.value.cooked ?? "")) report(expr, q.value.raw);
      if (expr.type === "ConditionalExpression") {
        checkExpression(expr.consequent);
        checkExpression(expr.alternate);
      }
      if (expr.type === "LogicalExpression") checkExpression(expr.right);
    };

    return {
      /** @param {any} node */
      JSXText(node) {
        if (hasWords(node.value)) report(node, node.value);
      },
      /** @param {any} node */
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (parent?.type === "JSXElement" || parent?.type === "JSXFragment")
          checkExpression(node.expression);
      },
      /** @param {any} node */
      JSXAttribute(node) {
        const name =
          node.name.type === "JSXNamespacedName" ? node.name.name.name : String(node.name.name);
        if (!TEXT_PROPS.test(name) || !node.value) return;
        if (node.value.type === "Literal") checkExpression(node.value);
        else if (node.value.type === "JSXExpressionContainer")
          checkExpression(node.value.expression);
      },
    };
  },
};

export default { rules: { "no-hardcoded-text": rule } };
