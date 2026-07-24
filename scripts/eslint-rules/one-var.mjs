// @ts-check

/**
 * Enforce `one-var: 'never'` — disallow declaring multiple variables in a single statement; each
 * binding must get its own `const`/`let`/`var`. (oxlint has no native `one-var` rule.)
 *
 * Only fires on declarations with MORE THAN ONE declarator, so single binding-less patterns like
 * `let {} = obj` (one declarator) are untouched. Skipped, to match ESLint's `never` behavior:
 *  - `for (let i = 0, j = 0; …)` initializers — they can't be split into separate statements
 *  - TypeScript ambient declarations — `declare const a, b`, `.d.ts` files, and anything inside
 *    `declare global` / `declare module` / `declare namespace` (idiomatic, not splittable the same way)
 */
export default {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'Require one variable per declaration statement (`one-var: never`)',
			recommended: true,
		},
		messages: {
			split: 'Declare one variable per statement (split this into separate `const`/`let`/`var` declarations).',
		},
		schema: [],
	},
	/** @param {import('@oxlint/plugins').Context} context */
	createOnce(context) {
		let ambientFile = false;
		return {
			Program() {
				const f = context.filename ?? '';
				ambientFile = f.endsWith('.d.ts') || f.endsWith('.d.mts') || f.endsWith('.d.cts');
			},
			/** @param {any} node */
			VariableDeclaration(node) {
				// Single declarator (incl. `let {} = obj`, `const [a] = x`) is always fine.
				if (node.declarations.length <= 1) return;
				// Ambient declarations aren't split the same way.
				if (ambientFile || node.declare === true) return;
				const parent = node.parent;
				// `for (let i = 0, j = 0; …)` — the multi-decl head can't be split.
				if (parent != null && parent.type === 'ForStatement' && parent.init === node) return;
				// Inside `declare global` / `declare module` / `declare namespace`.
				for (let cur = parent; cur != null; cur = cur.parent) {
					if (cur.type === 'TSModuleDeclaration') return;
				}
				context.report({ node: node, messageId: 'split' });
			},
		};
	},
};
