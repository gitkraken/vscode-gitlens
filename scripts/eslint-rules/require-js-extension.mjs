// @ts-check

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require an explicit .js extension on local (@env/ and relative) imports',
			recommended: true,
		},
		messages: {
			env: '@env/ imports must end with a .js extension',
			relative: 'Relative imports must include an explicit file extension (use .js)',
		},
		fixable: 'code',
		schema: [],
	},
	/** @param {import('@oxlint/plugins').Context} context */
	createOnce(context) {
		/** @param {{ value: unknown, raw?: string }} source */
		const check = source => {
			const value = source.value;
			if (typeof value !== 'string') return;

			let messageId;
			if (value.startsWith('@env/')) {
				if (value.endsWith('.js')) return;
				messageId = 'env';
			} else if (value.startsWith('./') || value.startsWith('../')) {
				// A dot in the final path segment means an extension is present (.js, .jsx, .css, .scss, .ts, …);
				// explicit-but-wrong extensions like .ts are owned by `import/extensions`. Only flag extensionless.
				if (value.slice(value.lastIndexOf('/') + 1).includes('.')) return;
				messageId = 'relative';
			} else {
				return;
			}

			context.report({
				node: source,
				messageId: messageId,
				fix(fixer) {
					const quote = source.raw?.[0] ?? "'";
					return fixer.replaceText(source, `${quote}${value}.js${quote}`);
				},
			});
		};

		return {
			ImportDeclaration(node) {
				check(node.source);
			},
			ExportNamedDeclaration(node) {
				if (node.source != null) check(node.source);
			},
			ExportAllDeclaration(node) {
				if (node.source != null) check(node.source);
			},
		};
	},
};
