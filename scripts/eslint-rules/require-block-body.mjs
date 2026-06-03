// @ts-check

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require block bodies for if/while/for/for-in/for-of. Single-line if is only allowed when its body is control flow (return, break, continue, throw, yield).',
			recommended: true,
		},
		messages: {
			wrapIfBody:
				'Single-line if statements are only allowed for control flow (return, break, continue, throw, yield). Wrap the body in braces.',
			wrapLoopBody: 'Single-line {{kind}} statements are not allowed. Wrap the body in braces.',
		},
		fixable: 'code',
		schema: [],
	},
	/** @param {import('@oxlint/plugins').Context} context */
	createOnce(context) {
		// Resolved per-file in the Program visitor — `context.sourceCode` is unavailable in `createOnce` itself.
		let sourceCode;

		function isControlFlowExit(stmt) {
			if (!stmt) return true;
			switch (stmt.type) {
				case 'ReturnStatement':
				case 'BreakStatement':
				case 'ContinueStatement':
				case 'ThrowStatement':
					return true;
				case 'ExpressionStatement':
					return stmt.expression.type === 'YieldExpression';
				default:
					return false;
			}
		}

		function indentOf(node) {
			const line = sourceCode.lines[node.loc.start.line - 1] ?? '';
			const match = line.match(/^[\t ]*/);
			return match ? match[0] : '';
		}

		function wrapFix(stmt, fixer) {
			const outer = indentOf(stmt.parent);
			const inner = `${outer}\t`;
			const text = sourceCode.getText(stmt);
			return fixer.replaceText(stmt, `{\n${inner}${text}\n${outer}}`);
		}

		function checkIfBranch(stmt) {
			if (stmt.type === 'BlockStatement' || isControlFlowExit(stmt)) return;
			context.report({
				node: stmt,
				messageId: 'wrapIfBody',
				fix: fixer => wrapFix(stmt, fixer),
			});
		}

		function checkLoopBody(node, kind) {
			const body = node.body;
			if (body.type === 'BlockStatement') return;
			context.report({
				node: body,
				messageId: 'wrapLoopBody',
				data: { kind: kind },
				fix: fixer => wrapFix(body, fixer),
			});
		}

		return {
			Program() {
				sourceCode = context.sourceCode ?? context.getSourceCode();
			},
			IfStatement(node) {
				checkIfBranch(node.consequent);
				if (node.alternate && node.alternate.type !== 'IfStatement') {
					checkIfBranch(node.alternate);
				}
			},
			WhileStatement(node) {
				checkLoopBody(node, 'while');
			},
			ForStatement(node) {
				checkLoopBody(node, 'for');
			},
			ForInStatement(node) {
				checkLoopBody(node, 'for-in');
			},
			ForOfStatement(node) {
				checkLoopBody(node, 'for-of');
			},
		};
	},
};
