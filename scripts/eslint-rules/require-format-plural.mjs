// @ts-check

import { createTranslatorTracker, literalValue, objectProperty } from './l10n.utils.mjs';

const pluralBlock = /\{\s*[^{},\s][^{},]*,\s*plural\s*,/;

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require plural-block localization messages to be rendered through formatPlural()',
			recommended: true,
		},
		messages: {
			wrap: 'A message with a `{…, plural, …}` block must be the first argument of formatPlural(); rendered directly it shows the raw block.',
			args: 'Pass the arguments to formatPlural(), not to the translator; the block is resolved after translation.',
			import: "Import formatPlural from '@gitlens/utils/plural.js' to render this message.",
		},
		schema: [],
	},
	/** @param {import('@oxlint/plugins').Context} context */
	createOnce(context) {
		const tracker = createTranslatorTracker();
		const formatters = new Set();

		return {
			Program() {
				tracker.reset();
				formatters.clear();
			},
			ImportDeclaration(node) {
				const source = node.source.value;
				if (source === '@gitlens/utils/plural.js' || /\/plural\.js$/.test(source)) {
					for (const specifier of node.specifiers) {
						if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'formatPlural') {
							formatters.add(specifier.local.name);
						}
					}

					return;
				}

				tracker.trackImport(node);
			},
			CallExpression(node) {
				if (!tracker.isTranslator(node.callee)) return;

				const first = node.arguments[0];
				const object = first?.type === 'ObjectExpression' ? first : undefined;
				const message = literalValue(object ? objectProperty(object, 'message')?.value : first);
				if (message == null || !pluralBlock.test(message)) return;

				if (object ? objectProperty(object, 'args') != null : node.arguments.length > 1) {
					context.report({ node: node, messageId: 'args' });
				}

				const parent = node.parent;
				const wrapped =
					parent?.type === 'CallExpression' &&
					parent.arguments[0] === node &&
					parent.callee.type === 'Identifier' &&
					(formatters.has(parent.callee.name) || parent.callee.name === 'formatPlural');
				if (!wrapped) {
					context.report({ node: node, messageId: formatters.size === 0 ? 'import' : 'wrap' });
				}
			},
		};
	},
};
