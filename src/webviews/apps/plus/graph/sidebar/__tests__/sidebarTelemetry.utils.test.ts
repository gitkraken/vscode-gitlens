import * as assert from 'assert';
import { getSidebarTagNameFromPath, resolveSelectedTag } from '../sidebarTelemetry.utils.js';

suite('getSidebarTagNameFromPath', () => {
	test('list mode: parses name after the second colon', () => {
		assert.strictEqual(getSidebarTagNameFromPath('flat:abc123:v1.0'), 'v1.0');
	});

	test('list mode: preserves colons within the tag name', () => {
		assert.strictEqual(getSidebarTagNameFromPath('flat:abc123:release:1.0'), 'release:1.0');
	});

	test('tree mode: strips the leading slash from a simple name', () => {
		assert.strictEqual(getSidebarTagNameFromPath('/v2.0'), 'v2.0');
	});

	test('tree mode: strips only the leading slash from a nested name', () => {
		assert.strictEqual(getSidebarTagNameFromPath('/release/1.0'), 'release/1.0');
	});

	test('returns undefined for an undefined path', () => {
		assert.strictEqual(getSidebarTagNameFromPath(undefined), undefined);
	});
});

suite('resolveSelectedTag', () => {
	const annotated = { name: 'release/1.0', sha: 'shared', annotated: true };
	const lightweight = { name: 'v1.0', sha: 'shared', annotated: false };
	const other = { name: 'v2.0', sha: 'other', annotated: false };
	const items = [annotated, lightweight, other];

	test('resolves the nested tag by tree-mode path (leading slash)', () => {
		assert.strictEqual(resolveSelectedTag(items, 'shared', '/release/1.0'), annotated);
	});

	test('resolves by list-mode path', () => {
		assert.strictEqual(resolveSelectedTag(items, 'shared', 'flat:shared:v1.0'), lightweight);
	});

	test('two tags sharing a commit resolve distinctly by path, not sha', () => {
		// Both `annotated` and `lightweight` are on sha `shared`; the path must decide which one.
		assert.strictEqual(resolveSelectedTag(items, 'shared', '/release/1.0'), annotated);
		assert.strictEqual(resolveSelectedTag(items, 'shared', '/v1.0'), lightweight);
	});

	test('falls back to the first sha match when the path does not resolve to a name', () => {
		assert.strictEqual(resolveSelectedTag(items, 'shared', undefined), annotated);
		assert.strictEqual(resolveSelectedTag(items, 'other', '/nonexistent'), other);
	});

	test('returns undefined when neither path nor sha matches', () => {
		assert.strictEqual(resolveSelectedTag(items, 'missing', '/nonexistent'), undefined);
	});
});
