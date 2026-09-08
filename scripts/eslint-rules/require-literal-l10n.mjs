// @ts-check

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
		const namespaces = new Set();
		const vscodeNamespaces = new Set();
		const functions = new Set();
		function isTranslator(node) {
			if (node.type === 'Identifier') return functions.has(node.name);
			if (node.type !== 'MemberExpression' || node.computed || node.property.name !== 't') return false;
			const object = node.object;
			if (object.type === 'Identifier') return namespaces.has(object.name);
			return (
				object.type === 'MemberExpression' &&
				!object.computed &&
				object.property.name === 'l10n' &&
				object.object.type === 'Identifier' &&
				vscodeNamespaces.has(object.object.name)
			);
		}
		function isLiteral(node) {
			return (
				(node?.type === 'Literal' && typeof node.value === 'string') ||
				(node?.type === 'TemplateLiteral' && node.expressions.length === 0)
			);
		}
		return {
			Program() {
				namespaces.clear();
				vscodeNamespaces.clear();
				functions.clear();
			},
			ImportDeclaration(node) {
				const source = node.source.value;
				if (source !== 'vscode' && source !== '@vscode/l10n') return;
				for (const specifier of node.specifiers) {
					if (specifier.type === 'ImportNamespaceSpecifier') {
						(source === 'vscode' ? vscodeNamespaces : namespaces).add(specifier.local.name);
					} else if (specifier.type === 'ImportSpecifier') {
						if (specifier.imported.name === 'l10n') namespaces.add(specifier.local.name);
						if (source === '@vscode/l10n' && specifier.imported.name === 't')
							functions.add(specifier.local.name);
					}
				}
			},
			CallExpression(node) {
				if (!isTranslator(node.callee)) return;
				const first = node.arguments[0];
				const message =
					first?.type === 'ObjectExpression'
						? first.properties.find(
								property =>
									property.type === 'Property' &&
									!property.computed &&
									(property.key.name ?? property.key.value) === 'message',
							)?.value
						: first;
				if (!isLiteral(message)) context.report({ node: first ?? node, messageId: 'literal' });
			},
		};
	},
};
