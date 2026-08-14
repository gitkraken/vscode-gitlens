import * as assert from 'assert';
import type { ParsedRef } from '../adornments/refAdornmentProvider.js';
import { partitionRowRefs, resolveAutoRefPillCap } from '../adornments/refAdornmentProvider.js';

function head(name: string, overrides?: Partial<ParsedRef>): ParsedRef {
	return { kind: 'head', name: name, id: `repo|heads/${name}`, ...overrides };
}

function remote(owner: string, name: string, overrides?: Partial<ParsedRef>): ParsedRef {
	return { kind: 'remote', name: name, owner: owner, id: `repo|remotes/${owner}/${name}`, ...overrides };
}

/** A head tracking `owner/name`, paired with the remote ref it tracks (`upstreamId` ⇒ the exact-id match). */
function tracked(name: string, owner: string): { local: ParsedRef; upstream: ParsedRef } {
	const upstream = remote(owner, name);
	return {
		local: head(name, { upstreamName: `${owner}/${name}`, upstreamId: upstream.id }),
		upstream: upstream,
	};
}

function tag(name: string): ParsedRef {
	return { kind: 'tag', name: name };
}

// The default cap. Every assertion here is the CURRENT single-pill behavior — the primary ref, the remote
// absorbed into its upstream segment, and what's left for the +N popover.
suite('refAdornmentProvider — partitionRowRefs at the default cap of 1', () => {
	test('a lone ref is the only pill and absorbs nothing', () => {
		const only = head('main');
		const { visible, rest } = partitionRowRefs([only], 1, undefined);

		assert.deepStrictEqual(visible, [{ ref: only, upstreamOnRow: undefined }]);
		assert.deepStrictEqual(rest, []);
	});

	test('an in-sync upstream remote is absorbed into its local', () => {
		const { local, upstream } = tracked('main', 'origin');
		const { visible, rest } = partitionRowRefs([local, upstream], 1, undefined);

		assert.deepStrictEqual(visible, [{ ref: local, upstreamOnRow: upstream }]);
		assert.deepStrictEqual(rest, [], 'the absorbed remote is not listed again');
	});

	// A click-pinned remote is ranked by ITSELF (no carrier substitution), so it lands at index 0. Absorbing
	// it into the local below would demote the very ref the click asked for.
	test('a remote ranked first is NOT absorbed by a lower-ranked local', () => {
		const { local, upstream } = tracked('main', 'origin');
		const { visible, rest, upstreamFor } = partitionRowRefs([upstream, local], 1, undefined);

		assert.deepStrictEqual(visible, [{ ref: upstream, upstreamOnRow: undefined }]);
		assert.deepStrictEqual(rest, [local]);
		assert.strictEqual(upstreamFor.get(local), undefined);
	});

	// Fork topology: an UNTRACKED local matches any co-located remote sharing its bare name, so both
	// `origin/main` and `upstream/main` are candidates.
	test('an untracked local absorbs the first same-named remote', () => {
		const local = head('main');
		const origin = remote('origin', 'main');
		const fork = remote('upstream', 'main');
		const { visible, rest } = partitionRowRefs([local, origin, fork], 1, undefined);

		assert.deepStrictEqual(visible, [{ ref: local, upstreamOnRow: origin }]);
		assert.deepStrictEqual(rest, [fork]);
	});

	test('the searched remote wins the first pill over an earlier candidate', () => {
		const local = head('main');
		const origin = remote('origin', 'main');
		const fork = remote('upstream', 'main');
		const { visible, rest } = partitionRowRefs([local, origin, fork], 1, 'remote:upstream/main');

		assert.deepStrictEqual(visible, [{ ref: local, upstreamOnRow: fork }], 'the find hit is the absorbed remote');
		assert.deepStrictEqual(rest, [origin]);
	});

	test('a find hit on something else leaves the first-match absorption alone', () => {
		const local = head('main');
		const origin = remote('origin', 'main');
		const fork = remote('upstream', 'main');
		const { visible, rest } = partitionRowRefs([local, origin, fork], 1, 'head:main');

		assert.deepStrictEqual(visible, [{ ref: local, upstreamOnRow: origin }]);
		assert.deepStrictEqual(rest, [fork]);
	});

	test('a tag is never absorbed', () => {
		const { local, upstream } = tracked('main', 'origin');
		const v1 = tag('v1.0');
		const { visible, rest } = partitionRowRefs([local, upstream, v1], 1, undefined);

		assert.deepStrictEqual(visible, [{ ref: local, upstreamOnRow: upstream }]);
		assert.deepStrictEqual(rest, [v1]);
	});

	test('a head in the overflow keeps its remote, paired through upstreamFor', () => {
		const first = head('main', { current: true });
		const feature = tracked('feature', 'origin');
		const { visible, rest, upstreamFor } = partitionRowRefs([first, feature.local, feature.upstream], 1, undefined);

		assert.deepStrictEqual(visible, [{ ref: first, upstreamOnRow: undefined }]);
		assert.deepStrictEqual(rest, [feature.local], 'the absorbed remote is not a row of its own');
		assert.strictEqual(upstreamFor.get(feature.local), feature.upstream);
	});

	// A remote outranking the local that tracks it (e.g. a default-branch remote before an ordinary local)
	// still pairs with it — absorption is by rank, not by position.
	test('a head absorbs the remote it tracks even when that remote is listed first', () => {
		const current = head('other', { current: true });
		const mine = tracked('main', 'origin');
		const { visible, rest, upstreamFor } = partitionRowRefs([current, mine.upstream, mine.local], 1, undefined);

		assert.deepStrictEqual(visible, [{ ref: current, upstreamOnRow: undefined }]);
		assert.deepStrictEqual(rest, [mine.local]);
		assert.strictEqual(upstreamFor.get(mine.local), mine.upstream);
	});

	test('an unrelated remote is never absorbed', () => {
		const main = head('main', { current: true });
		const other = remote('origin', 'other');
		const { visible, rest } = partitionRowRefs([main, other], 1, undefined);

		assert.deepStrictEqual(visible, [{ ref: main, upstreamOnRow: undefined }]);
		assert.deepStrictEqual(rest, [other]);
	});
});

suite('refAdornmentProvider — partitionRowRefs above the default cap', () => {
	test('a cap of 2 renders the first two units as pills', () => {
		const main = tracked('main', 'origin');
		const feature = head('feature');
		const v1 = tag('v1.0');
		const { visible, rest } = partitionRowRefs([main.local, main.upstream, feature, v1], 2, undefined);

		assert.deepStrictEqual(
			visible,
			[
				{ ref: main.local, upstreamOnRow: main.upstream },
				{ ref: feature, upstreamOnRow: undefined },
			],
			'the absorbed pair counts as ONE unit against the cap',
		);
		assert.deepStrictEqual(rest, [v1]);
	});

	test('the overflow still pairs its heads with their remotes', () => {
		const main = tracked('main', 'origin');
		const feature = tracked('feature', 'origin');
		const v1 = tag('v1.0');
		const { visible, rest, upstreamFor } = partitionRowRefs(
			[main.local, main.upstream, v1, feature.local, feature.upstream],
			2,
			undefined,
		);

		assert.deepStrictEqual(visible, [
			{ ref: main.local, upstreamOnRow: main.upstream },
			{ ref: v1, upstreamOnRow: undefined },
		]);
		assert.deepStrictEqual(rest, [feature.local]);
		assert.strictEqual(upstreamFor.get(feature.local), feature.upstream);
	});

	test('a remote ranked first still keeps its own pill', () => {
		const { local, upstream } = tracked('main', 'origin');
		const { visible, rest } = partitionRowRefs([upstream, local], 2, undefined);

		assert.deepStrictEqual(visible, [
			{ ref: upstream, upstreamOnRow: undefined },
			{ ref: local, upstreamOnRow: undefined },
		]);
		assert.deepStrictEqual(rest, []);
	});

	test('a cap past the unit count leaves nothing in the overflow', () => {
		const main = tracked('main', 'origin');
		const v1 = tag('v1.0');
		const { visible, rest, upstreamFor } = partitionRowRefs([main.local, main.upstream, v1], 5, undefined);

		assert.deepStrictEqual(visible, [
			{ ref: main.local, upstreamOnRow: main.upstream },
			{ ref: v1, upstreamOnRow: undefined },
		]);
		assert.deepStrictEqual(rest, []);
		assert.strictEqual(upstreamFor.get(main.local), main.upstream);
	});
});

// The `'auto'` mode's cap: `floor(availableWidth / assumedRefPillWidth)` clamped to [1, 10]. The pill
// width assumption (110) isn't exported — these boundaries are derived from it, not hardcoded twice.
suite('refAdornmentProvider — resolveAutoRefPillCap', () => {
	test('zero width falls back to 1', () => {
		assert.strictEqual(resolveAutoRefPillCap(0), 1);
	});

	test('negative width falls back to 1', () => {
		assert.strictEqual(resolveAutoRefPillCap(-50), 1);
	});

	test('non-finite width falls back to 1', () => {
		assert.strictEqual(resolveAutoRefPillCap(NaN), 1);
		assert.strictEqual(resolveAutoRefPillCap(Infinity), 1);
	});

	test('just below the 2-pill boundary still fits only 1', () => {
		assert.strictEqual(resolveAutoRefPillCap(219), 1);
	});

	test('at the 2-pill boundary fits 2', () => {
		assert.strictEqual(resolveAutoRefPillCap(220), 2);
	});

	test('a very wide row clamps to the setting max of 10', () => {
		assert.strictEqual(resolveAutoRefPillCap(2000), 10);
	});
});
