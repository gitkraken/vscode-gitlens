const path = require('path');

module.exports = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow import statements that start with src/',
			recommended: true,
		},
		fixable: 'code',
		schema: [],
	},
	create(context) {
		return {
			ImportDeclaration(node) {
				const importPath = node.source.value;
				if (importPath.startsWith('src/')) {
					context.report({
						node,
						message: 'Import from src/ should be rewritten to a relative path',
						fix(fixer) {
							const importPathAbsolute = path.resolve('.', importPath);
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
