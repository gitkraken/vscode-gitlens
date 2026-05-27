import * as assert from 'assert';
import { pickScopePageTarget } from '../utils/scopePaging.utils.js';

suite('pickScopePageTarget', () => {
	test('returns an unloaded, unrequested anchor sha when one exists', () => {
		const anchors = new Set(['anchor1']);
		const loaded = new Set<string>();
		const requested = new Set<string>();
		assert.strictEqual(pickScopePageTarget(anchors, loaded, requested, undefined), 'anchor1');
	});

	test('skips loaded anchors and falls through to mergeBase when none missing', () => {
		// Mirrors the actual bug scenario: library flags loaded branch/upstream tips as unreachable
		// because `scope.mergeBase` row isn't loaded yet. The handler must page targeted at the
		// mergeBase sha, not return undefined.
		const anchors = new Set(['branchTipLoaded', 'upstreamTipLoaded']);
		const loaded = new Set(['branchTipLoaded', 'upstreamTipLoaded']);
		const requested = new Set<string>();
		assert.strictEqual(pickScopePageTarget(anchors, loaded, requested, 'mergeBaseSha'), 'mergeBaseSha');
	});

	test('returns undefined when mergeBase is already loaded', () => {
		const anchors = new Set(['branchTip']);
		const loaded = new Set(['branchTip', 'mergeBaseSha']);
		const requested = new Set<string>();
		assert.strictEqual(pickScopePageTarget(anchors, loaded, requested, 'mergeBaseSha'), undefined);
	});

	test('returns undefined when mergeBase is already in flight', () => {
		// Dedupe guard — a previous unreachable event already issued GetMoreRowsCommand for the
		// mergeBase. Don't re-fire while the response is still in flight.
		const anchors = new Set(['branchTip']);
		const loaded = new Set(['branchTip']);
		const requested = new Set(['mergeBaseSha']);
		assert.strictEqual(pickScopePageTarget(anchors, loaded, requested, 'mergeBaseSha'), undefined);
	});

	test('returns undefined when no anchors are missing and mergeBase is undefined', () => {
		// Pre-mergeBase-resolution state: scope just got set, ResolveGraphScopeRequest hasn't
		// returned yet. Library can't have flagged anchors unreachable for the mergeBase path
		// since u is undefined; nothing useful for us to page.
		const anchors = new Set(['branchTip']);
		const loaded = new Set(['branchTip']);
		const requested = new Set<string>();
		assert.strictEqual(pickScopePageTarget(anchors, loaded, requested, undefined), undefined);
	});

	test('skips already-requested anchors and returns next unloaded one', () => {
		const anchors = new Set(['a', 'b', 'c']);
		const loaded = new Set(['a']);
		const requested = new Set(['b']);
		assert.strictEqual(pickScopePageTarget(anchors, loaded, requested, undefined), 'c');
	});

	test('returns undefined when every anchor is loaded or requested and no mergeBase', () => {
		const anchors = new Set(['a', 'b']);
		const loaded = new Set(['a']);
		const requested = new Set(['b']);
		assert.strictEqual(pickScopePageTarget(anchors, loaded, requested, undefined), undefined);
	});
});
