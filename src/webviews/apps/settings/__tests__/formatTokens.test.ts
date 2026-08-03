import * as assert from 'assert';
import { getCommitFormatTokens, getFileFormatTokens, getFormatTokens } from '../format-tokens.js';

/**
 * The format-editor token catalog (#5392 Doc D). The keys of the commit/file maps
 * are drift-guarded at COMPILE TIME (`Record<keyof …tokenOptions>`); these tests
 * cover the runtime context-classification the type can't express — that
 * hover/markdown-only tokens are offered only in hover fields, never in plaintext
 * commit fields.
 */
suite('format editor — token catalog', () => {
	const hoverOnly = ['avatar', 'commands', 'footnotes', 'link', 'signature'];

	test('commit context excludes the hover/markdown-only tokens', () => {
		const tokens = getCommitFormatTokens(false).map(t => t.token);
		for (const t of hoverOnly) {
			assert.ok(!tokens.includes(t), `commit context must not offer the hover-only token "${t}"`);
		}
		// Sanity: it still offers the core commit tokens
		assert.ok(tokens.includes('author'));
		assert.ok(tokens.includes('message'));
		assert.ok(tokens.includes('agoOrDate'));
	});

	test('hover context offers commit tokens PLUS the hover-only tokens', () => {
		const tokens = getCommitFormatTokens(true).map(t => t.token);
		for (const t of hoverOnly) {
			assert.ok(tokens.includes(t), `hover context must offer the hover-only token "${t}"`);
		}
		assert.ok(tokens.includes('author'));
	});

	test('file context offers the StatusFileFormatter tokens', () => {
		const tokens = getFileFormatTokens().map(t => t.token);
		for (const t of ['file', 'directory', 'path', 'filePath', 'originalPath', 'status', 'working']) {
			assert.ok(tokens.includes(t), `file context must offer "${t}"`);
		}
		// It must NOT leak commit-only tokens
		assert.ok(!tokens.includes('author'));
	});

	test('getFormatTokens resolves each context to a non-empty, labeled set', () => {
		for (const context of ['commit', 'hover', 'file'] as const) {
			const tokens = getFormatTokens(context);
			assert.ok(tokens.length > 0, `${context} context should be non-empty`);
			assert.ok(
				tokens.every(t => t.token && t.label),
				`${context} tokens must all have a token and a label`,
			);
		}
	});
});
