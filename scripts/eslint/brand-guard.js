// @ts-check
/**
 * Brand Guard: colors and sizes come from @forgecy/ui tokens, never from code. Reports
 * hand-written colors and pixel sizes in string literals and template-literal text, which
 * also covers Tailwind arbitrary values such as `bg-[#fff]` or `w-[13px]`.
 */
const COLOR =
  /#[0-9a-fA-F]{3,8}\b|(?<![A-Za-z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/;
const PIXELS = /(?:^|[\s[:(,_])-?(?:\d+\.?\d*|\.\d+)px\b/;

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow hand-written colors and pixel sizes; use the design tokens." },
    schema: [],
    messages: {
      color: "Brand Guard: hand-written color `{{text}}`. Use @forgecy/ui tokens.",
      size: "Brand Guard: hand-written pixel size `{{text}}`. Use the spacing and type tokens.",
    },
  },
  create(context) {
    /**
     * @param {import("eslint").Rule.Node} node
     * @param {string} text
     */
    const check = (node, text) => {
      const color = COLOR.exec(text);
      if (color) return context.report({ node, messageId: "color", data: { text: color[0] } });
      const size = PIXELS.exec(text);
      if (size) context.report({ node, messageId: "size", data: { text: size[0].trim() } });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export default { rules: { "no-hand-written-design-values": rule } };
