import * as assert from 'assert';
import { emptySetMarker } from '@gitkraken/commit-graph-ui/filtering.js';
import { countLoadedIncludedRefs, pickScopePageTarget } from '@gitkraken/commit-graph-ui/scopePaging.js';

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
		// Dedupe guard — a previous unreachable event already issued a page request for the
		// mergeBase. Don't re-fire while the response is still in flight.
		const anchors = new Set(['branchTip']);
		const loaded = new Set(['branchTip']);
		const requested = new Set(['mergeBaseSha']);
		assert.strictEqual(pickScopePageTarget(anchors, loaded, requested, 'mergeBaseSha'), undefined);
	});

	test('returns undefined when no anchors are missing and mergeBase is undefined', () => {
		// Pre-mergeBase-resolution state: scope just got set, GraphScopeService.resolveScope hasn't
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

suite('countLoadedIncludedRefs', () => {
	test('counts a ref as loaded only when its id decorated a row', () => {
		const refs = { 'refs/heads/main': {}, 'refs/heads/old': {} };
		const result = countLoadedIncludedRefs(refs, new Set(['refs/heads/main']));
		assert.deepStrictEqual(result, { loaded: 1, total: 2 });
	});

	test('ignores the empty-set sentinel so a narrowed-to-nothing filter reports nothing to disclose', () => {
		// `favorited`/`agents` with no matching branches ship `{ [emptySetMarker]: … }` to mean "include
		// nothing". Counting it would render a permanent "0 of 1 branches" footer with no way to resolve it.
		const result = countLoadedIncludedRefs({ [emptySetMarker]: {} }, new Set<string>());
		assert.deepStrictEqual(result, { loaded: 0, total: 0 });
	});

	test('counts real refs alongside the sentinel without counting the sentinel itself', () => {
		const refs = { [emptySetMarker]: {}, 'refs/heads/main': {} };
		const result = countLoadedIncludedRefs(refs, new Set(['refs/heads/main']));
		assert.deepStrictEqual(result, { loaded: 1, total: 1 });
	});

	test('reports zero totals for an undefined or empty ref set', () => {
		assert.deepStrictEqual(countLoadedIncludedRefs(undefined, new Set(['a'])), { loaded: 0, total: 0 });
		assert.deepStrictEqual(countLoadedIncludedRefs({}, new Set(['a'])), { loaded: 0, total: 0 });
	});

	test('reports every ref loaded once all ids are present', () => {
		// The footer's suppression condition — `loaded >= total` must be reachable, or it never goes away.
		const refs = { 'refs/heads/main': {}, 'refs/remotes/origin/main': {} };
		const loadedIds = new Set(['refs/heads/main', 'refs/remotes/origin/main', 'refs/heads/unrelated']);
		assert.deepStrictEqual(countLoadedIncludedRefs(refs, loadedIds), { loaded: 2, total: 2 });
	});
});
