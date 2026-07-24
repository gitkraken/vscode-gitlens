// @ts-check

/**
 * Disallow `x instanceof CancellationError`; use the `isCancellationError(ex)` type guard instead.
 *
 * `instanceof` is unreliable for `CancellationError` because the error can originate from a different
 * realm/bundle (VS Code host vs. extension) where the constructor identity differs. `isCancellationError()`
 * checks structurally and works across those boundaries.
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow `instanceof CancellationError`; use `isCancellationError()` instead',
			recommended: true,
		},
		messages: {
			useHelper: 'Use `isCancellationError(ex)` instead of `instanceof CancellationError`.',
		},
		fixable: 'code',
		schema: [],
	},
	/** @param {import('@oxlint/plugins').Context} context */
	createOnce(context) {
		// `context.sourceCode` is only available inside the Program visitor, not in `createOnce` itself.
		let sourceCode;
		return {
			Program() {
				sourceCode = context.sourceCode;
			},
			/** @param {import('estree').BinaryExpression} node */
			BinaryExpression(node) {
				if (
					node.operator === 'instanceof' &&
					node.right.type === 'Identifier' &&
					node.right.name === 'CancellationError'
				) {
					context.report({
						node,
						messageId: 'useHelper',
						// Note: assumes `isCancellationError` is in scope; where it isn't, type-checking flags the
						// missing import (loud, not silent). The fixer can't add imports itself.
						fix: fixer => fixer.replaceText(node, `isCancellationError(${sourceCode.getText(node.left)})`),
					});
				}
			},
		};
	},
};
