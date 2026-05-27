// @ts-check

/**
 * Require a blank line after a control flow statement.
 *
 * "Control flow" here means: return / throw / break / continue, a bare
 * `yield x;` ExpressionStatement, a single-line `if (cond) <cf>;`, or a
 * block-form if whose block terminates in control flow.
 *
 * The blank line is NOT required when the next sibling is also a control flow
 * statement, so chains of guards stay tight.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
	meta: {
		type: 'layout',
		docs: {
			description: 'Require a blank line after a control flow statement',
			recommended: true,
		},
		messages: {
			missingBlankLine: 'Expected a blank line after a control flow statement.',
		},
		fixable: 'whitespace',
		schema: [],
	},
	create(context) {
		const sourceCode = context.sourceCode;

		/**
		 * @param {import('estree').Node | null | undefined} node
		 * @returns {boolean}
		 */
		function isControlFlow(node) {
			if (!node) return false;
			switch (node.type) {
				case 'ReturnStatement':
				case 'ThrowStatement':
				case 'BreakStatement':
				case 'ContinueStatement':
					return true;
				case 'ExpressionStatement':
					// @ts-ignore - estree typing for ExpressionStatement.expression
					return node.expression?.type === 'YieldExpression';
				case 'IfStatement':
					// @ts-ignore - estree typing
					return isControlFlow(node.consequent);
				case 'BlockStatement':
					// @ts-ignore - estree typing
					return node.body.length > 0 && isControlFlow(node.body[node.body.length - 1]);
				default:
					return false;
			}
		}

		/**
		 * @param {import('estree').Node[]} body
		 */
		function checkBody(body) {
			for (let i = 0; i < body.length - 1; i++) {
				const cur = body[i];
				const next = body[i + 1];

				if (!isControlFlow(cur)) continue;
				if (isControlFlow(next)) continue;

				const lastTokenCur = sourceCode.getLastToken(cur);
				if (!lastTokenCur?.loc) continue;

				let curEndLine = lastTokenCur.loc.end.line;
				let curEndRange = lastTokenCur.range[1];

				const commentsBetween = sourceCode.getCommentsAfter(cur);
				let leadingCommentOfNext = null;
				for (const c of commentsBetween) {
					if (c.loc && c.loc.start.line === curEndLine) {
						curEndLine = c.loc.end.line;
						curEndRange = c.range[1];
					} else {
						leadingCommentOfNext = c;
						break;
					}
				}

				const nextStartLine = leadingCommentOfNext?.loc
					? leadingCommentOfNext.loc.start.line
					: next.loc.start.line;

				if (nextStartLine - curEndLine >= 2) continue;

				const insertAfterRange = curEndRange;
				context.report({
					node: cur,
					messageId: 'missingBlankLine',
					fix(fixer) {
						return fixer.insertTextAfterRange([0, insertAfterRange], '\n');
					},
				});
			}
		}

		return {
			Program(node) {
				checkBody(node.body);
			},
			BlockStatement(node) {
				checkBody(node.body);
			},
			SwitchCase(node) {
				checkBody(node.consequent);
			},
			StaticBlock(node) {
				// @ts-ignore - StaticBlock isn't in estree typings, but ESLint emits it
				checkBody(node.body);
			},
		};
	},
};
