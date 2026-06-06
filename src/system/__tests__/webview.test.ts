import * as assert from 'assert';
import { mergeWebviewItems, mergeWebviewItemsUnion } from '../webview.js';

suite('mergeWebviewItems', () => {
	test('returns undefined for an empty list', () => {
		assert.strictEqual(mergeWebviewItems([]), undefined);
	});

	test('returns the single item unchanged', () => {
		assert.strictEqual(mergeWebviewItems(['gitlens:file+committed']), 'gitlens:file+committed');
	});

	test('keeps the shared base + flags present on every item', () => {
		assert.strictEqual(
			mergeWebviewItems(['gitlens:file+committed+worktree', 'gitlens:file+committed+worktree']),
			'gitlens:file+committed+worktree',
		);
	});

	test('drops flags not present on every item', () => {
		assert.strictEqual(
			mergeWebviewItems(['gitlens:file+committed+worktree', 'gitlens:file+committed']),
			'gitlens:file+committed',
		);
	});

	test('collapses a mixed staged/unstaged selection to the bare base (hides flag-specific multi)', () => {
		assert.strictEqual(mergeWebviewItems(['gitlens:file+staged', 'gitlens:file+unstaged']), 'gitlens:file');
	});

	test('returns undefined when base types differ', () => {
		assert.strictEqual(mergeWebviewItems(['gitlens:file+staged', 'gitlens:commit']), undefined);
	});

	test('counts flags per item, not per unique context (duplicate contexts keep the common flag)', () => {
		// 3 items / 1 unique string: +staged is on all 3 → kept. (The graph boil-down counts unique
		// contexts and would drop it; mergeWebviewItems counts per item, which is the correct behavior.)
		assert.strictEqual(
			mergeWebviewItems(['gitlens:file+staged', 'gitlens:file+staged', 'gitlens:file+staged']),
			'gitlens:file+staged',
		);
	});
});

suite('mergeWebviewItemsUnion', () => {
	test('empty → undefined', () => {
		assert.strictEqual(mergeWebviewItemsUnion([]), undefined);
	});

	test('single item passes through', () => {
		assert.strictEqual(mergeWebviewItemsUnion(['gitlens:file+unstaged']), 'gitlens:file+unstaged');
	});

	test('unions flags across a mixed selection (the key difference from the intersection)', () => {
		// mergeWebviewItems would collapse this to bare `gitlens:file`; the union keeps both flags so a
		// Stage/Unstage/Discard `.multi` `when` still matches.
		assert.strictEqual(
			mergeWebviewItemsUnion(['gitlens:file+staged', 'gitlens:file+unstaged']),
			'gitlens:file+staged+unstaged',
		);
	});

	test('dedupes flags shared across items', () => {
		assert.strictEqual(
			mergeWebviewItemsUnion(['gitlens:file+unstaged', 'gitlens:file+unstaged']),
			'gitlens:file+unstaged',
		);
	});

	test('committed + WIP unions to keep both — discard `when` matches via the WIP flag', () => {
		assert.strictEqual(
			mergeWebviewItemsUnion(['gitlens:file+committed', 'gitlens:file+unstaged']),
			'gitlens:file+committed+unstaged',
		);
	});

	test('differing base types → undefined', () => {
		assert.strictEqual(mergeWebviewItemsUnion(['gitlens:file+staged', 'gitlens:commit']), undefined);
	});
});
