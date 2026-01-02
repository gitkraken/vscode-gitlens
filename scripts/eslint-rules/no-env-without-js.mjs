// @ts-check

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Enforce .js extension on @env/ imports',
			recommended: true,
		},
		messages: {
			missingExtension: '@env/ imports must end with .js extension',
		},
		fixable: 'code',
		schema: [],
	},
	create(context) {
		return {
			ImportDeclaration(node) {
				const source = node.source.value;
				if (typeof source === 'string' && source.startsWith('@env/') && !source.endsWith('.js')) {
					context.report({
						node: node.source,
						messageId: 'missingExtension',
						fix(fixer) {
							const quote = node.source.raw?.[0] ?? "'";
							return fixer.replaceText(node.source, `${quote}${source}.js${quote}`);
						},
					});
				}
			},
		};
	},
};
