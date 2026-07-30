// @ts-check

/**
 * Disallow SCSS syntax inside `` css`…` `` tagged templates.
 *
 * A Lit `css` template is plain CSS — no preprocessor runs over it — so SCSS-isms don't just fail to
 * compile, they take working declarations with them:
 *
 * - `//` is not a CSS comment. The parser reads it as a declaration and, recovering, swallows
 *   everything up to the next `;` — which is the declaration *after* the comment.
 * - `margin: { right: 0.2rem; }` is SCSS nested-property syntax. In CSS the whole block is invalid
 *   and discarded.
 *
 * Both are silent at runtime and were shipping. They also hide from every other check: `postcss-lit`
 * can't parse the template, and stylelint skips a template it can't parse — so one bad line disables
 * every CSS rule for that whole block.
 */

const doubleSlash = /(^|\n)[^\S\n]*\/\//;
// A declaration whose value opens a block — `margin: {`. Excludes `@media (…) {`, `&:hover {` and
// ordinary selectors, none of which put a `:` before the brace on the same line with no selector after.
const nestedProperty = /(^|\n)[^\S\n]*([a-z-]+)[^\S\n]*:[^\S\n]*\{/;

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow SCSS syntax inside `css` tagged templates',
			recommended: true,
		},
		messages: {
			doubleSlash:
				'`//` is not a CSS comment — the parser discards it *and* the declaration after it. Use `/* … */`.',
			nestedProperty:
				'`{{property}}: {…}` is SCSS nested-property syntax; CSS discards the whole block. Write the longhand properties instead.',
		},
		schema: [],
	},
	/** @param {import('@oxlint/plugins').Context} context */
	createOnce(context) {
		let sourceCode;
		return {
			Program() {
				sourceCode = context.sourceCode;
			},
			/** @param {any} node */
			TaggedTemplateExpression(node) {
				if (node.tag?.type !== 'Identifier' || node.tag.name !== 'css') return;

				for (const quasi of node.quasi.quasis) {
					const text = quasi.value.raw;
					const start = quasi.range?.[0] ?? quasi.start;

					for (const [pattern, messageId] of [
						[doubleSlash, 'doubleSlash'],
						[nestedProperty, 'nestedProperty'],
					]) {
						const match = pattern.exec(text);
						if (match == null) continue;

						// Point at the offending line, not the whole template — these run hundreds of lines.
						const index = start + match.index + match[0].indexOf(match[0].trim()[0]);
						context.report({
							loc: sourceCode.getLocFromIndex(index),
							messageId: messageId,
							data: { property: match[2] ?? '' },
						});
					}
				}
			},
		};
	},
};
