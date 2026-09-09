// @ts-check

import { createTranslatorTracker, literalValue, messageArgument } from './l10n.utils.mjs';

export default {
	meta: {
		type: 'problem',
		docs: { description: 'Require statically extractable localization messages', recommended: true },
		messages: {
			literal:
				'Use a literal localization message and pass dynamic values as placeholder arguments; computed messages are not extracted.',
		},
		schema: [],
	},
	/** @param {import('@oxlint/plugins').Context} context */
	createOnce(context) {
		const tracker = createTranslatorTracker();

		return {
			Program() {
				tracker.reset();
			},
			ImportDeclaration(node) {
				tracker.trackImport(node);
			},
			CallExpression(node) {
				if (!tracker.isTranslator(node.callee)) return;

				const message = messageArgument(node);
				if (literalValue(message) == null) {
					context.report({ node: node.arguments[0] ?? node, messageId: 'literal' });
				}
			},
		};
	},
};
