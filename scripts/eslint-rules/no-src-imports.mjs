// @ts-check

import * as path from 'node:path';

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow import statements that start with src/',
			recommended: true,
		},
		messages: {
			rewriteRelative: 'src/ imports must be rewritten to a relative path',
		},
		fixable: 'code',
		schema: [],
	},
	create(context) {
		return {
			ImportDeclaration(node) {
				const source = node.source.value;
				if (typeof source === 'string' && source.startsWith('src/')) {
					context.report({
						node: node.source,
						message: 'rewriteRelative',
						fix(fixer) {
							const importPathAbsolute = path.resolve('.', source);
							const relativePath = path.relative(path.dirname(context.getFilename()), importPathAbsolute);
							const normalizedPath = path.normalize(relativePath).replace(/\\/g, '/');
							return fixer.replaceText(node.source, `'${normalizedPath}'`);
						},
					});
				}
			},
		};
	},
};
