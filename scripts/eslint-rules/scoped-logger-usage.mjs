// @ts-check

/**
 * ESLint rule to enforce correct usage of getScopedLogger()
 *
 * Rules:
 * 1. getScopedLogger() should be called in a method with @log() or @debug() decorator
 * 2. getScopedLogger() should be called before any await statement (browser limitation)
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Enforce correct usage of getScopedLogger()',
			recommended: true,
		},
		messages: {
			missingDecorator:
				'getScopedLogger() should be called in a method decorated with @info(), @debug(), or @trace(). Either add the decorator or use startScopedLogger() instead.',
			afterAwait:
				'getScopedLogger() should be called before any await statement. In browsers, async local storage may be stale after await. Move the call to the start of the method.',
		},
		schema: [],
	},
	create(context) {
		/**
		 * Check if a method has @info(), @debug(), or @trace() decorator
		 * @param {import('estree').Node | null | undefined} node
		 * @returns {boolean}
		 */
		function hasLogDecorator(node) {
			if (!node || node.type !== 'MethodDefinition') return false;

			// @ts-ignore - decorators is a TS-specific property
			const decorators = node.decorators;
			if (!decorators || !Array.isArray(decorators)) return false;

			return decorators.some(decorator => {
				const expr = decorator.expression;
				// Handle @info(), @debug(), or @trace() - call expressions
				if (expr && expr.type === 'CallExpression') {
					const callee = expr.callee;
					if (callee && callee.type === 'Identifier') {
						return callee.name === 'info' || callee.name === 'debug' || callee.name === 'trace';
					}
				}
				// Handle @info(), @debug(), or @trace() - plain identifiers (without parens)
				if (expr && expr.type === 'Identifier') {
					return expr.name === 'info' || expr.name === 'debug' || expr.name === 'trace';
				}
				return false;
			});
		}

		/**
		 * Check if there's an await expression before the given node in the same function
		 * @param {import('estree').Node} node - The getScopedLogger() call node
		 * @param {import('estree').Node} functionBody - The function body to search in
		 * @returns {boolean}
		 */
		function hasAwaitBefore(node, functionBody) {
			if (!functionBody || functionBody.type !== 'BlockStatement') return false;

			const nodeStart = node.range?.[0] ?? 0;
			let foundAwait = false;

			/**
			 * @param {import('estree').Node} n
			 */
			function traverse(n) {
				if (foundAwait) return;
				if (!n) return;

				// Check if this is an await expression before our node
				if (n.type === 'AwaitExpression') {
					const awaitEnd = n.range?.[1] ?? 0;
					if (awaitEnd < nodeStart) {
						foundAwait = true;
						return;
					}
				}

				// Don't traverse into nested functions/methods
				if (
					n.type === 'FunctionDeclaration' ||
					n.type === 'FunctionExpression' ||
					n.type === 'ArrowFunctionExpression'
				) {
					return;
				}

				// Traverse children
				for (const key of Object.keys(n)) {
					if (key === 'parent' || key === 'range' || key === 'loc') continue;
					// @ts-ignore
					const child = n[key];
					if (Array.isArray(child)) {
						for (const c of child) {
							if (c && typeof c === 'object' && c.type) {
								traverse(c);
							}
						}
					} else if (child && typeof child === 'object' && child.type) {
						traverse(child);
					}
				}
			}

			traverse(functionBody);
			return foundAwait;
		}

		return {
			CallExpression(node) {
				// Check if this is a getScopedLogger() call
				if (node.callee.type !== 'Identifier' || node.callee.name !== 'getScopedLogger') {
					return;
				}

				// Find the containing method
				const sourceCode = context.sourceCode ?? context.getSourceCode();
				// @ts-ignore
				const ancestors = context.getAncestors?.() ?? sourceCode.getAncestors?.(node) ?? [];

				let methodDef = null;
				let functionBody = null;

				for (let i = ancestors.length - 1; i >= 0; i--) {
					const ancestor = ancestors[i];
					if (ancestor.type === 'MethodDefinition') {
						methodDef = ancestor;
						// @ts-ignore
						functionBody = ancestor.value?.body;
						break;
					}
					// Also handle standalone functions (not methods)
					if (
						ancestor.type === 'FunctionDeclaration' ||
						ancestor.type === 'FunctionExpression' ||
						ancestor.type === 'ArrowFunctionExpression'
					) {
						functionBody = ancestor.body;
						// For non-method functions, we won't report missing decorator
						// since decorators only apply to methods
						break;
					}
				}

				// Check for decorator on method
				if (methodDef && !hasLogDecorator(methodDef)) {
					context.report({
						node: node,
						messageId: 'missingDecorator',
					});
				}

				// Check for await before getScopedLogger()
				if (functionBody && hasAwaitBefore(node, functionBody)) {
					context.report({
						node: node,
						messageId: 'afterAwait',
					});
				}
			},
		};
	},
};
