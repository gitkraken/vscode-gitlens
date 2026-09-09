// @ts-check

export function createTranslatorTracker() {
	const namespaces = new Set();
	const vscodeNamespaces = new Set();
	const functions = new Set();

	function reset() {
		namespaces.clear();
		vscodeNamespaces.clear();
		functions.clear();
	}

	function trackImport(node) {
		const source = node.source.value;
		if (source !== 'vscode' && source !== '@vscode/l10n') return;

		for (const specifier of node.specifiers) {
			if (specifier.type === 'ImportNamespaceSpecifier') {
				(source === 'vscode' ? vscodeNamespaces : namespaces).add(specifier.local.name);
			} else if (specifier.type === 'ImportSpecifier') {
				if (specifier.imported.name === 'l10n') namespaces.add(specifier.local.name);
				if (source === '@vscode/l10n' && specifier.imported.name === 't') functions.add(specifier.local.name);
			}
		}
	}

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

	return { reset, trackImport, isTranslator };
}

export function literalValue(node) {
	if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
	if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;

	return undefined;
}

export function objectProperty(objectExpressionNode, name) {
	return objectExpressionNode?.properties.find(
		property =>
			property.type === 'Property' && !property.computed && (property.key.name ?? property.key.value) === name,
	);
}

export function messageArgument(callNode) {
	const first = callNode.arguments[0];
	if (first?.type !== 'ObjectExpression') return first;

	return objectProperty(first, 'message')?.value;
}
