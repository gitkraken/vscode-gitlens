import * as assert from 'assert';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type {
	emptySetMarker,
	GraphIncludeOnlyRef,
	GraphIncludeOnlyRefs,
	GraphRebindRefusalReason,
	GraphScope,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphWipRow,
	GraphWipRowsById,
	GraphWipState,
	State,
	WorkDirStats,
} from '../../../../plus/graph/protocol.js';
import { createWipRowId } from '../../../../plus/graph/protocol.js';
import type { GetOverviewEnrichmentResponse } from '../../../../shared/overviewBranches.js';
import type { AppState } from '../context.js';
import type { ResolvedScopeAnchor } from '../stateProvider.js';
import {
	applyScopeAnchorPatch,
	countLoadedSearchResults,
	countRenderedSearchResults,
	GraphStateProvider,
	isScopeAnchorStale,
	mergeWipRows,
	mergeWipState,
	reconcileScopeMergeTarget,
	resolveFullStateWorkingTreeStats,
	shouldRestoreSearchQuery,
} from '../stateProvider.js';
import type { SelectionBranch, SelectionContext } from '../utils/branchSelection.utils.js';
import { getOverviewBranchSelectionSha } from '../utils/branchSelection.utils.js';
import {
	filterSecondariesForIncludeOnlyRefs,
	filterSecondariesForScope,
	filterSecondariesForScopeAndVisibility,
	isScopeFocalHead,
	shouldShowPrimaryWipRow,
} from '../utils/wip.utils.js';

// Exercised against a minimal fake `this` (the same approach `graphWipService.test.ts` takes) rather than
// a constructed provider, which would need a live webview context. Couples to the private field names.
suite('GraphStateProvider WIP stats supersession', () => {
	type FakeThis = { _wipStatsRequestSeq: number; _wipStatsRequestBySha: Map<string, number> };
	const proto = GraphStateProvider.prototype;

	function createFakeThis(): FakeThis {
		return { _wipStatsRequestSeq: 0, _wipStatsRequestBySha: new Map() };
	}
	const claim = (t: FakeThis, shas: string[]) => proto.claimWipStatsRequest.call(t, shas);
	const isCurrent = (t: FakeThis, sha: string, ticket: number) => proto.isCurrentWipStatsRequest.call(t, sha, ticket);

	// Batches no longer cancel each other, so a slow earlier read can land AFTER a newer one. Without a
	// per-sha claim it would overwrite fresh counts with older ones — the responses carry no revision.
	test('a later request supersedes an earlier one for the same sha', () => {
		const t = createFakeThis();
		const first = claim(t, ['wip::/a']);
		const second = claim(t, ['wip::/a']);

		assert.strictEqual(isCurrent(t, 'wip::/a', first), false, 'the older read must not apply');
		assert.strictEqual(isCurrent(t, 'wip::/a', second), true);
	});

	// Supersession is PER SHA: overlapping batches usually ask about different rows, and a later batch
	// claiming row B must not invalidate an in-flight batch's claim on row A.
	test('a later request leaves shas it did not claim alone', () => {
		const t = createFakeThis();
		const first = claim(t, ['wip::/a', 'wip::/b']);
		claim(t, ['wip::/b']);

		assert.strictEqual(isCurrent(t, 'wip::/a', first), true, 'an unclaimed sha keeps its owner');
		assert.strictEqual(isCurrent(t, 'wip::/b', first), false);
	});

	test('a sha nobody claimed is current for no one', () => {
		const t = createFakeThis();
		const ticket = claim(t, ['wip::/a']);

		assert.strictEqual(isCurrent(t, 'wip::/unknown', ticket), false);
	});
});

suite('mergeWipRows', () => {
	test('returns undefined when incoming is undefined', () => {
		const result = mergeWipRows({ 'wip::/a': wipRow('a', 'sha1') }, undefined);
		assert.strictEqual(result, undefined);
	});

	test('returns incoming when prev is undefined', () => {
		const incoming: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1') };
		const result = mergeWipRows(undefined, incoming);
		assert.strictEqual(result, incoming);
	});

	test('preserves prev reference when all entries are equivalent', () => {
		const prev: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1'), 'wip::/b': wipRow('b', 'sha2') };
		const incoming: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1'), 'wip::/b': wipRow('b', 'sha2') };

		const result = mergeWipRows(prev, incoming);

		assert.strictEqual(result, prev, 'expected reference-preservation when anchor fields match');
	});

	test('produces a new object when an anchor field changes', () => {
		const prev: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1') };
		const incoming: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha2') };

		const result = mergeWipRows(prev, incoming);

		assert.notStrictEqual(result, prev);
		assert.strictEqual(result?.['wip::/a']?.parentSha, 'sha2');
	});

	test('produces a new object when a sha is added', () => {
		const prev: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1') };
		const incoming: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1'), 'wip::/b': wipRow('b', 'sha2') };

		const result = mergeWipRows(prev, incoming);

		assert.notStrictEqual(result, prev);
		assert.ok(result?.['wip::/b']);
	});

	test('produces a new object when a sha is removed', () => {
		const prev: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1'), 'wip::/b': wipRow('b', 'sha2') };
		const incoming: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1') };

		const result = mergeWipRows(prev, incoming);

		assert.notStrictEqual(result, prev);
		assert.strictEqual(Object.keys(result ?? {}).length, 1);
	});

	test('produces a new object when branchRef changes (branch rename without sha change)', () => {
		const prev: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', '/repo|heads/old') };
		const incoming: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', '/repo|heads/new') };

		const result = mergeWipRows(prev, incoming);

		assert.notStrictEqual(result, prev);
		assert.strictEqual(result?.['wip::/a']?.branchRef, '/repo|heads/new');
	});

	test('preserves prev reference when branchRef matches (and other anchors match)', () => {
		const prev: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', '/repo|heads/feature') };
		const incoming: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', '/repo|heads/feature') };

		const result = mergeWipRows(prev, incoming);

		assert.strictEqual(result, prev);
	});

	// Regression: removing the last peer worktree must clear its row on the webview side. The host
	// returns `{}` (not `undefined`) when no worktrees exist so JSON survives the field; this test pins
	// the merge behavior so a future "optimize empties to undefined" change can't silently reintroduce
	// phantom anchors.
	test('returns an empty map when incoming is empty and prev has entries', () => {
		const prev: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1'), 'wip::/b': wipRow('b', 'sha2') };
		const result = mergeWipRows(prev, {});

		assert.notStrictEqual(result, prev);
		assert.deepStrictEqual(result, {});
	});

	// Regression: a change confined to the projected branch (e.g. `behind` moving after a fetch) must
	// not be discarded by reference-preservation — the WIP bar's hover renders from it.
	test('produces a new object when only the projected branch changes', () => {
		const prev: GraphWipRowsById = { 'wip::/a': { ...wipRow('a', 'sha1'), branch: overviewBranch(0) } };
		const incoming: GraphWipRowsById = { 'wip::/a': { ...wipRow('a', 'sha1'), branch: overviewBranch(2) } };

		const result = mergeWipRows(prev, incoming);

		assert.notStrictEqual(result, prev);
	});
});

suite('mergeWipState', () => {
	const rows: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1'), 'wip::/b': wipRow('b', 'sha2') };
	const pausedRebase = pausedOp();
	const stats = (added: number, deleted: number, modified: number): WorkDirStats => ({
		added: added,
		deleted: deleted,
		modified: modified,
	});

	test('returns prev when incoming is undefined', () => {
		const prev: State['wipStateById'] = { 'wip::/a': { ahead: 1 } };
		assert.strictEqual(mergeWipState(prev, undefined, rows, undefined), prev);
	});

	test('preserves prev reference when nothing changes', () => {
		const prev: State['wipStateById'] = {
			'wip::/a': { workDirStats: stats(1, 0, 2), workDirStatsStale: false, ahead: 1 },
		};
		const result = mergeWipState(prev, { 'wip::/a': { ahead: 1 } }, rows, undefined);

		assert.strictEqual(result, prev, 'expected reference-preservation when the merged entry is unchanged');
	});

	// The status group travels as ONE unit from a single `git status`: a push carrying `workDirStats`
	// replaces the whole group, which is what lets a completed rebase actually clear `pausedOpStatus`.
	test('replaces the whole status group when incoming carries workDirStats', () => {
		const prev: State['wipStateById'] = {
			'wip::/a': {
				workDirStats: stats(7, 3, 1),
				hasConflicts: true,
				conflictsCount: 2,
				pausedOpStatus: pausedRebase,
			},
		};
		const result = mergeWipState(prev, { 'wip::/a': { workDirStats: stats(1, 0, 0) } }, rows, undefined);

		const merged = result?.['wip::/a'];
		assert.deepStrictEqual(merged?.workDirStats, stats(1, 0, 0));
		assert.strictEqual(merged?.pausedOpStatus, undefined, 'a completed paused op must clear');
		assert.strictEqual(merged?.hasConflicts, undefined);
		assert.strictEqual(merged?.conflictsCount, undefined);
	});

	// A stats-only patch (`toWipStatePatch` — a refetch or a status push) carries NO enumeration fields,
	// so the replace branch must keep them rather than let the spread drop them. `ahead` is the one that
	// bites: losing it degrades a peer pill's hover from a real count to the bare unpushed bit until an
	// enumeration build happens to arrive. The sibling merge in `graph-wrapper.onWipShasMissingStats`
	// preserves it by spreading prev, so disagreeing here also made the two paths inconsistent.
	test('preserves ahead across a stats-only patch', () => {
		const prev: State['wipStateById'] = {
			'wip::/a': { ahead: 3, hasUnpushed: true, workDirStats: stats(1, 1, 1) },
		};
		const result = mergeWipState(prev, { 'wip::/a': { workDirStats: stats(2, 0, 0) } }, rows, undefined);

		const merged = result?.['wip::/a'];
		assert.deepStrictEqual(merged?.workDirStats, stats(2, 0, 0), 'the status group is still replaced');
		assert.strictEqual(merged?.ahead, 3, 'the enumeration count must survive a stats-only patch');
		assert.strictEqual(merged?.hasUnpushed, true);
	});

	test('an incoming ahead still wins over the stored one', () => {
		const prev: State['wipStateById'] = { 'wip::/a': { ahead: 3 } };
		const result = mergeWipState(prev, { 'wip::/a': { workDirStats: stats(1, 0, 0), ahead: 9 } }, rows, undefined);

		assert.strictEqual(result?.['wip::/a']?.ahead, 9, 'preservation must not shadow a fresh value');
	});

	// The mirror case: an anchors-only push (per-tick topology, no `git status` for this row) must not
	// blank a peer's client-fetched stats — that's the visible pill flash.
	test('preserves the status group when incoming carries no workDirStats', () => {
		const prev: State['wipStateById'] = {
			'wip::/a': {
				workDirStats: stats(7, 3, 1),
				workDirStatsStale: false,
				hasConflicts: true,
				conflictsCount: 2,
				pausedOpStatus: pausedRebase,
			},
		};
		const result = mergeWipState(prev, { 'wip::/a': { ahead: 4 } }, rows, undefined);

		const merged = result?.['wip::/a'];
		assert.deepStrictEqual(merged?.workDirStats, stats(7, 3, 1));
		assert.strictEqual(merged?.workDirStatsStale, false);
		assert.strictEqual(merged?.hasConflicts, true);
		assert.strictEqual(merged?.conflictsCount, 2);
		assert.strictEqual(merged?.pausedOpStatus, pausedRebase);
		assert.strictEqual(merged?.ahead, 4);
	});

	test('preserves prev hasUnpushed/hasChanges when incoming omits them (per-tick push)', () => {
		const prev: State['wipStateById'] = { 'wip::/a': { hasUnpushed: true, hasChanges: true } };
		const result = mergeWipState(prev, { 'wip::/a': { ahead: 0 } }, rows, undefined);

		const merged = result?.['wip::/a'];
		assert.strictEqual(merged?.hasUnpushed, true);
		assert.strictEqual(merged?.hasChanges, true);
	});

	test('applies hasUnpushed when incoming carries it (push clears it)', () => {
		const prev: State['wipStateById'] = { 'wip::/a': { ahead: 3, hasUnpushed: true } };
		const result = mergeWipState(prev, { 'wip::/a': { ahead: 0, hasUnpushed: false } }, rows, undefined);

		assert.notStrictEqual(result, prev);
		assert.strictEqual(result?.['wip::/a']?.ahead, 0, '`ahead` is free every build, so it always applies');
		assert.strictEqual(result?.['wip::/a']?.hasUnpushed, false);
	});

	// Regression: pill flash on graph rows. When an entry briefly drops out of `wipStateById`
	// (worktree-list flap, transient `wt.sha == null`, reduced-set full-state push) and re-enters, we
	// seed `workDirStats` from the sticky last-known map and mark the entry stale so the GK component
	// refetches without ever rendering an empty pill.
	test('seeds workDirStats from lastKnownStats for a newly-seen row', () => {
		const lastKnown = new Map<string, WorkDirStats>([['wip::/a', stats(5, 1, 3)]]);
		const result = mergeWipState(undefined, { 'wip::/a': {} }, rows, undefined, lastKnown);

		const merged = result?.['wip::/a'];
		assert.deepStrictEqual(merged?.workDirStats, stats(5, 1, 3));
		assert.strictEqual(merged?.workDirStatsStale, true);
	});

	test('does not seed from lastKnownStats when incoming already carries workDirStats', () => {
		const lastKnown = new Map<string, WorkDirStats>([['wip::/a', stats(1, 1, 1)]]);
		const result = mergeWipState(
			undefined,
			{ 'wip::/a': { workDirStats: stats(9, 9, 9) } },
			rows,
			undefined,
			lastKnown,
		);

		assert.deepStrictEqual(result?.['wip::/a']?.workDirStats, stats(9, 9, 9));
		assert.notStrictEqual(result?.['wip::/a']?.workDirStatsStale, true);
	});

	test('does not seed from lastKnownStats when prev already has stats for the row', () => {
		const prev: State['wipStateById'] = { 'wip::/a': { workDirStats: stats(2, 2, 2), workDirStatsStale: false } };
		const lastKnown = new Map<string, WorkDirStats>([['wip::/a', stats(1, 1, 1)]]);
		const result = mergeWipState(prev, { 'wip::/a': {} }, rows, undefined, lastKnown);

		assert.strictEqual(result, prev);
	});

	// `wipRowsById` is authoritative for existence — a removed worktree must not leave a phantom entry.
	test('prunes entries for rows the topology plane no longer has', () => {
		const prev: State['wipStateById'] = { 'wip::/a': { ahead: 1 }, 'wip::/gone': { ahead: 2 } };
		const result = mergeWipState(prev, {}, rows, undefined);

		assert.notStrictEqual(result, prev);
		assert.deepStrictEqual(Object.keys(result ?? {}), ['wip::/a']);
	});

	// ...except the graph's own worktree, whose status has an independent producer and lifetime: a
	// failed worktree enumeration must not blank the header badges.
	test('never prunes the primary row, even when absent from the topology plane', () => {
		const prev: State['wipStateById'] = { 'wip::/primary': { workDirStats: stats(1, 0, 0) } };
		const result = mergeWipState(prev, {}, {}, 'wip::/primary');

		assert.deepStrictEqual(Object.keys(result ?? {}), ['wip::/primary']);
	});

	// The background probe's cheap dirty bit and the carried-forward counts are produced by different
	// reads with no shared ordering, so a disagreement can't be resolved by either one. Flagging the
	// counts stale routes it to an authoritative `git status` instead of letting the unstamped bit win —
	// a probe issued before an edit could otherwise land after fresh counts and wrongly clean the row.
	test('flags carried stats stale when an incoming clean probe contradicts them', () => {
		const prev: State['wipStateById'] = {
			'wip::/a': { workDirStats: stats(3, 0, 1), workDirStatsStale: false, hasChanges: true },
		};
		const result = mergeWipState(prev, { 'wip::/a': { hasChanges: false } }, rows, undefined);

		const merged = result?.['wip::/a'];
		assert.deepStrictEqual(merged?.workDirStats, stats(3, 0, 1), 'the counts are kept, not overwritten');
		assert.strictEqual(merged?.workDirStatsStale, true);
		assert.strictEqual(merged?.hasChanges, false);
	});

	// Regression: a phantom pill in the WIP bar. `hasChanges` is the probe's cheap bit and it used to be
	// carried forward forever, so a worktree that was dirty at graph load kept `hasChanges: true` even after
	// an authoritative `git status` reported it clean. Any consumer that falls back to the bit when the
	// counts read unverified — the bar's pill rule does, deliberately, so a stale row can't go quiet —
	// then re-reported the cleaned worktree as dirty the moment its row scrolled out and its counts were
	// flagged stale. Authoritative counts must RETIRE the bit, not defer to it.
	test('retires a stale hasChanges when authoritative counts say clean', () => {
		const prev: State['wipStateById'] = {
			'wip::/a': { workDirStats: stats(4, 1, 2), hasChanges: true },
		};
		const result = mergeWipState(prev, { 'wip::/a': { workDirStats: stats(0, 0, 0) } }, rows, undefined);

		assert.strictEqual(result?.['wip::/a']?.hasChanges, false, 'the probe bit must not outlive a real status');
	});

	test('sets hasChanges from authoritative counts that say dirty', () => {
		const prev: State['wipStateById'] = { 'wip::/a': { workDirStats: stats(0, 0, 0), hasChanges: false } };
		const result = mergeWipState(prev, { 'wip::/a': { workDirStats: stats(0, 0, 3) } }, rows, undefined);

		assert.strictEqual(result?.['wip::/a']?.hasChanges, true);
	});

	test('leaves stats alone when a clean probe agrees with zeroed counts', () => {
		const prev: State['wipStateById'] = {
			'wip::/a': { workDirStats: stats(0, 0, 0), workDirStatsStale: false, hasChanges: true },
		};
		const result = mergeWipState(prev, { 'wip::/a': { hasChanges: false } }, rows, undefined);

		assert.notStrictEqual(result?.['wip::/a']?.workDirStatsStale, true);
	});

	test('ignores an incoming entry for a row the topology plane does not have', () => {
		const prev: State['wipStateById'] = { 'wip::/a': { ahead: 1 } };
		const result = mergeWipState(prev, { 'wip::/unknown': { ahead: 5 } }, rows, undefined);

		assert.strictEqual(result?.['wip::/unknown'], undefined);
		assert.strictEqual(result, prev, 'a dropped entry is not a change');
	});
});

function wipRow(label: string, parentSha: string, branchRef?: string): GraphWipRow {
	return {
		repoPath: `/repos/${label}`,
		parentSha: parentSha,
		label: label,
		branchRef: branchRef,
	};
}

/** Minimal `OverviewBranch` stand-in — only the tracking state participates in `mergeWipRows`'s deep
 *  branch comparison, so the rest of the shape is elided rather than fabricated. */
function overviewBranch(behind: number): NonNullable<GraphWipRow['branch']> {
	const shape = { id: '/repo|heads/a', name: 'a', repoPath: '/repo', state: { ahead: 0, behind: behind } };
	return shape as unknown as NonNullable<GraphWipRow['branch']>;
}

/** Minimal paused-op stand-in — the merge only ever tests it for presence/identity. */
function pausedOp(): NonNullable<GraphWipState['pausedOpStatus']> {
	const shape = { type: 'rebase' };
	return shape as unknown as NonNullable<GraphWipState['pausedOpStatus']>;
}

suite('reconcileScopeMergeTarget', () => {
	const branchRef = '/repo|heads/feature';
	const scopeWithoutSha: NonNullable<AppState['scope']> = {
		branchRef: branchRef,
		branchName: 'feature',
		upstreamRef: undefined,
		mergeTargetTipSha: undefined,
	};

	test('returns the same scope reference when scope is undefined', () => {
		const result = reconcileScopeMergeTarget(undefined, makeEnrichment(branchRef, 'abc123'));
		assert.strictEqual(result, undefined);
	});

	test('returns the same scope reference when enrichment is undefined', () => {
		const result = reconcileScopeMergeTarget(scopeWithoutSha, undefined);
		assert.strictEqual(result, scopeWithoutSha);
	});

	test('returns the same scope reference when enrichment lacks the branch', () => {
		const result = reconcileScopeMergeTarget(scopeWithoutSha, makeEnrichment('/repo|heads/other', 'abc123'));
		assert.strictEqual(result, scopeWithoutSha);
	});

	test('returns the same scope reference when enrichment has no merge target', () => {
		const enrichment: GetOverviewEnrichmentResponse = { [branchRef]: {} };
		const result = reconcileScopeMergeTarget(scopeWithoutSha, enrichment);
		assert.strictEqual(result, scopeWithoutSha);
	});

	test('does not backfill mergeTargetTipSha when scope has neither mergeBase nor mergeTargetTipSha (bare scope)', () => {
		// `setScope` leaves the scope bare when the anchor IPC bailed or its merge base wasn't in
		// the loaded rows. Backfilling just the target tip pushes the scope walk into a path that
		// requires target ancestors to be loaded — for a stale target tip those aren't, and the
		// walk exposes every first-parent ancestor of the focal branch. Leaving the scope bare
		// keeps the foreign-ref heuristic active and bounds visibility correctly.
		const result = reconcileScopeMergeTarget(scopeWithoutSha, makeEnrichment(branchRef, 'abc123'));
		assert.strictEqual(result, scopeWithoutSha);
	});

	test('backfills mergeTargetTipSha when scope already has a mergeBase', () => {
		const scopeWithMergeBase = {
			...scopeWithoutSha,
			mergeBase: { sha: 'base', date: 1 },
		};
		const result = reconcileScopeMergeTarget(scopeWithMergeBase, makeEnrichment(branchRef, 'abc123'));
		assert.notStrictEqual(result, scopeWithMergeBase);
		assert.strictEqual(result?.mergeTargetTipSha, 'abc123');
		assert.strictEqual(result?.branchRef, branchRef);
	});

	test('returns the same scope reference when enrichment sha matches current mergeTargetTipSha', () => {
		const scopeWithSha = { ...scopeWithoutSha, mergeTargetTipSha: 'abc123' };
		const result = reconcileScopeMergeTarget(scopeWithSha, makeEnrichment(branchRef, 'abc123'));
		assert.strictEqual(result, scopeWithSha);
	});

	test('updates mergeTargetTipSha when enrichment sha differs from current', () => {
		const scopeWithSha = { ...scopeWithoutSha, mergeTargetTipSha: 'old' };
		const result = reconcileScopeMergeTarget(scopeWithSha, makeEnrichment(branchRef, 'new'));
		assert.notStrictEqual(result, scopeWithSha);
		assert.strictEqual(result?.mergeTargetTipSha, 'new');
	});
});

function makeEnrichment(branchRef: string, sha: string): GetOverviewEnrichmentResponse {
	return {
		[branchRef]: {
			mergeTarget: {
				repoPath: '/repo',
				id: '/repo|heads/main',
				sha: sha,
				name: 'main',
				targetBranch: 'main',
				baseBranch: undefined,
				defaultBranch: undefined,
			},
		},
	};
}

suite('isScopeAnchorStale', () => {
	const anchored: GraphScope = {
		branchRef: '/repo|heads/feature',
		branchName: 'feature',
		focalBranchTipSha: 'F1',
		mergeBase: { sha: 'M1', date: 1 },
		mergeTargetTipSha: 'M2',
	};

	test('returns false when there is no anchor to compare against', () => {
		assert.strictEqual(isScopeAnchorStale(anchored, undefined), false);
	});

	test('returns false for a bare scope — nothing resolved can be stale', () => {
		const bare: GraphScope = { branchRef: anchored.branchRef, branchName: 'feature', focalBranchTipSha: 'F1' };
		assert.strictEqual(
			isScopeAnchorStale(bare, { mergeBase: undefined, mergeTargetTipSha: undefined, focalBranchTipSha: 'F2' }),
			false,
		);
	});

	test('returns false when the resolver agrees with the live anchors', () => {
		assert.strictEqual(
			isScopeAnchorStale(anchored, {
				mergeBase: { sha: 'M1', date: 1 },
				mergeTargetTipSha: 'M2',
				focalBranchTipSha: 'F1',
			}),
			false,
		);
	});

	test('returns true when the resolver places the merge base elsewhere', () => {
		assert.strictEqual(
			isScopeAnchorStale(anchored, {
				mergeBase: { sha: 'M3', date: 2 },
				mergeTargetTipSha: 'M3',
				focalBranchTipSha: 'F1',
			}),
			true,
		);
	});

	test('returns true when the focal branch tip moved (rebase/amend/reset)', () => {
		// The resolver bails to a focal-tip-only answer when there's no merge target. Without this
		// signal the pre-rewrite mergeBase/mergeTargetTipSha ride along and keep marking the wrong rows.
		assert.strictEqual(
			isScopeAnchorStale(anchored, {
				mergeBase: undefined,
				mergeTargetTipSha: undefined,
				focalBranchTipSha: 'F2',
			}),
			true,
		);
	});

	test('returns false when the live scope was never stamped with a focal tip', () => {
		// Nothing to compare — an unstamped scope must not be torn down on the strength of a guess.
		const { focalBranchTipSha: _, ...unstamped } = anchored;
		assert.strictEqual(
			isScopeAnchorStale(unstamped, {
				mergeBase: undefined,
				mergeTargetTipSha: undefined,
				focalBranchTipSha: 'F2',
			}),
			false,
		);
	});
});

suite('applyScopeAnchorPatch', () => {
	const anchored: GraphScope = {
		branchRef: '/repo|heads/feature',
		branchName: 'feature',
		focalBranchTipSha: 'F1',
		mergeBase: { sha: 'M1', date: 1 },
		mergeTargetTipSha: 'M2',
	};
	test('an ordinary commit whose resolve comes back focal-tip-only keeps the merge base', () => {
		// The resolver bails to a focal-tip-only answer for several reasons, some transient (a cold
		// `getBranchMergeTargetInfo` timing out). A plain commit advances the tip without rewriting
		// anything, so staleness fires with no replacement in hand — dropping there would bare a
		// perfectly good scope and expand the view, with no rebase involved.
		const result = applyScopeAnchorPatch(anchored, {
			mergeBase: undefined,
			mergeTargetTipSha: undefined,
			focalBranchTipSha: 'F2',
		});
		assert.deepStrictEqual(result?.mergeBase, { sha: 'M1', date: 1 });
		assert.strictEqual(result?.mergeTargetTipSha, 'M2');
		assert.strictEqual(result?.focalBranchTipSha, 'F2');
	});

	test('an amend keeps the merge base and target — a rewrite that moves neither anchor', () => {
		// Amending replaces the tip commit but leaves the fork point and the target tip exactly where
		// they were, so both anchors are still correct and must survive.
		const result = applyScopeAnchorPatch(anchored, {
			mergeBase: { sha: 'M1', date: 1 },
			mergeTargetTipSha: 'M2',
			focalBranchTipSha: 'F1amend',
		});
		assert.deepStrictEqual(result?.mergeBase, { sha: 'M1', date: 1 });
		assert.strictEqual(result?.mergeTargetTipSha, 'M2');
		assert.strictEqual(result?.focalBranchTipSha, 'F1amend');
	});

	test('a rebase that moves the merge base replaces both anchors', () => {
		const result = applyScopeAnchorPatch(anchored, {
			mergeBase: { sha: 'M2', date: 2 },
			mergeTargetTipSha: 'M2',
			focalBranchTipSha: 'F2',
		});
		assert.deepStrictEqual(result?.mergeBase, { sha: 'M2', date: 2 });
		assert.strictEqual(result?.mergeTargetTipSha, 'M2');
	});

	test('a merge base is applied whether or not its commit is loaded yet', () => {
		// Loaded-ness is not a factor: anchor reachability is row membership, re-derived on every rows push,
		// so an anchor that resolves ahead of its rows is correct-but-early. Withholding one for it would
		// also withhold the paging that loads it.
		const result = applyScopeAnchorPatch(anchored, {
			mergeBase: { sha: 'M9', date: 9 },
			mergeTargetTipSha: 'M9',
			focalBranchTipSha: 'F2',
		});
		assert.deepStrictEqual(result?.mergeBase, { sha: 'M9', date: 9 });
	});

	test('a merge base that did not move still folds in a fresh merge-target tip', () => {
		const sameBase: GraphScope = { ...anchored, mergeBase: { sha: 'M9', date: 9 } };
		const result = applyScopeAnchorPatch(sameBase, {
			mergeBase: { sha: 'M9', date: 9 },
			mergeTargetTipSha: 'M9',
			focalBranchTipSha: 'F1',
		});
		assert.deepStrictEqual(result?.mergeBase, { sha: 'M9', date: 9 });
		assert.strictEqual(result?.mergeTargetTipSha, 'M9');
	});

	test('a rebase whose resolve bails leaves the stale anchors in place (known gap)', () => {
		// Indistinguishable from the ordinary-commit case above: focal-tip-only, tip moved, no
		// replacement offered. Closing it needs the host to distinguish "couldn't resolve" from
		// "no merge target exists"; until then the stale anchors survive to the next good resolve.
		const result = applyScopeAnchorPatch(anchored, {
			mergeBase: undefined,
			mergeTargetTipSha: undefined,
			focalBranchTipSha: 'REBASED',
		});
		assert.deepStrictEqual(result?.mergeBase, { sha: 'M1', date: 1 });
	});

	test('returns undefined when nothing changed', () => {
		const result = applyScopeAnchorPatch(anchored, {
			mergeBase: { sha: 'M1', date: 1 },
			mergeTargetTipSha: 'M2',
			focalBranchTipSha: 'F1',
		});
		assert.strictEqual(result, undefined);
	});
});

suite('filterSecondariesForScope', () => {
	const branchRef = '/repo|heads/feature';
	const upstreamRef = '/repo|remotes/origin/feature';
	const otherRef = '/repo|heads/other';

	test('returns input unchanged when scope is undefined', () => {
		const meta: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', branchRef) };
		const result = filterSecondariesForScope(meta, undefined);
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when metadata is undefined', () => {
		const result = filterSecondariesForScope(undefined, { branchRef: branchRef, branchName: 'feature' });
		assert.strictEqual(result, undefined);
	});

	test('keeps entries whose branchRef matches scope.branchRef', () => {
		const meta: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', branchRef) };
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.strictEqual(result, meta, 'no entries dropped → same reference');
	});

	test('drops worktrees on sibling local branches even when the scope has an upstream', () => {
		// Production worktree branchRefs are always `heads/*` (git only attaches worktrees to local
		// branches), so a worktree on a different local branch that tracks the same upstream as the
		// scope is treated as a sibling, not part of the scope. The `remotes/*` `upstreamRef` is
		// deliberately not part of the match set — see `filterSecondariesForScope`.
		const meta: GraphWipRowsById = {
			'wip::/scoped': wipRow('scoped', 'sha1', branchRef),
			'wip::/sibling': wipRow('sibling', 'sha2', '/repo|heads/feature-mirror'),
		};
		const result = filterSecondariesForScope(meta, {
			branchRef: branchRef,
			branchName: 'feature',
			upstreamRef: upstreamRef,
		});
		assert.ok(result?.['wip::/scoped']);
		assert.strictEqual(result?.['wip::/sibling'], undefined);
	});

	test('drops entries whose branchRef is unrelated to the scope', () => {
		const meta: GraphWipRowsById = {
			'wip::/a': wipRow('a', 'sha1', branchRef),
			'wip::/b': wipRow('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.notStrictEqual(result, meta);
		assert.ok(result?.['wip::/a']);
		assert.strictEqual(result?.['wip::/b'], undefined);
	});

	test('drops sha-colliding worktree on unrelated branch (the reproduction case)', () => {
		// Both worktrees have parentSha === scope.branchRef tip sha, but only one is actually on
		// the scoped branch — the other coincidentally shares a HEAD sha. Without branchRef-aware
		// filtering, the graph component's SHA filter would let both through.
		const meta: GraphWipRowsById = {
			'wip::/scoped': wipRow('scoped', 'sha-tip', branchRef),
			'wip::/coincident': wipRow('coincident', 'sha-tip', otherRef),
		};
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.ok(result?.['wip::/scoped']);
		assert.strictEqual(result?.['wip::/coincident'], undefined);
	});

	test('drops detached worktrees (branchRef undefined) under an active scope', () => {
		// A detached worktree has no branch identity to attribute to the scoped branch.
		// Surfacing it as a second "Working Changes (…)" row adjacent to the scoped worktree's
		// WIP just adds an unrelated entry to the user's view.
		const meta: GraphWipRowsById = { 'wip::/detached': wipRow('detached', 'sha1') };
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.deepStrictEqual(result, {}, 'detached entry dropped under scope');
	});

	test('drops entries with undefined branchRef even when scope has no upstream — does not match a bogus undefined slot', () => {
		// Regression guard: building the scope-ref set must not insert `undefined`. If it did,
		// detached entries would match the bogus undefined slot. The new policy drops them
		// outright instead of relying on the fall-through.
		const meta: GraphWipRowsById = {
			'wip::/detached': wipRow('detached', 'sha1'),
			'wip::/unrelated': wipRow('unrelated', 'sha2', otherRef),
		};
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.strictEqual(result?.['wip::/detached'], undefined, 'detached dropped');
		assert.strictEqual(result?.['wip::/unrelated'], undefined, 'unrelated dropped');
	});

	test('honors scope.additionalBranchRefs (stacked-branches forward-compat)', () => {
		const stackedRef = '/repo|heads/stacked';
		const meta: GraphWipRowsById = { 'wip::/stacked': wipRow('stacked', 'sha1', stackedRef) };
		const result = filterSecondariesForScope(meta, {
			branchRef: branchRef,
			branchName: 'feature',
			additionalBranchRefs: [stackedRef],
		});
		assert.strictEqual(result, meta);
	});
});

suite('filterSecondariesForIncludeOnlyRefs', () => {
	const branchRef = '/repo|heads/feature';
	const otherRef = '/repo|heads/other';

	test("returns input unchanged when branchesVisibility is 'all'", () => {
		const meta: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', branchRef) };
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'all', refsFor(branchRef));
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when branchesVisibility is undefined', () => {
		const meta: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', branchRef) };
		const result = filterSecondariesForIncludeOnlyRefs(meta, undefined, refsFor(branchRef));
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when includeOnlyRefs is undefined', () => {
		const meta: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', branchRef) };
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', undefined);
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when includeOnlyRefs is empty {} (no-filter sentinel)', () => {
		// Detached-HEAD smart/current modes send `{ refs: {} }` from the host. The graph
		// component treats empty `{}` as "no filter" — we must match that here so we don't
		// silently drop every secondary WIP.
		const meta: GraphWipRowsById = {
			'wip::/a': wipRow('a', 'sha1', branchRef),
			'wip::/b': wipRow('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'smart', {});
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when metadata is undefined', () => {
		const result = filterSecondariesForIncludeOnlyRefs(undefined, 'agents', refsFor(branchRef));
		assert.strictEqual(result, undefined);
	});

	test('keeps entries whose branchRef is in the include set', () => {
		const meta: GraphWipRowsById = { 'wip::/a': wipRow('a', 'sha1', branchRef) };
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', refsFor(branchRef));
		assert.strictEqual(result, meta, 'no entries dropped → same reference');
	});

	test('drops entries whose branchRef is not in the include set', () => {
		const meta: GraphWipRowsById = {
			'wip::/a': wipRow('a', 'sha1', branchRef),
			'wip::/b': wipRow('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', refsFor(branchRef));
		assert.notStrictEqual(result, meta);
		assert.ok(result?.['wip::/a']);
		assert.strictEqual(result?.['wip::/b'], undefined);
	});

	test('drops all real-branch entries when only the empty-set marker is present', () => {
		const meta: GraphWipRowsById = {
			'wip::/a': wipRow('a', 'sha1', branchRef),
			'wip::/b': wipRow('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', {
			['gk.empty-set-marker' satisfies typeof emptySetMarker]: {} as unknown as GraphIncludeOnlyRef,
		});
		assert.deepStrictEqual(result, {}, 'every real-branch entry dropped');
	});

	test('keeps detached worktrees (branchRef undefined) — defers to SHA filter under visibility-only mode', () => {
		// IMPORTANT: this helper applies under visibility filtering ONLY (no scope). It keeps
		// detached worktrees so the GK SHA-based filter decides whether they appear. The sibling
		// `filterSecondariesForScope` has the OPPOSITE policy under an active scope — it DROPS
		// detached worktrees because they can't be attributed to the scoped branch. If a future
		// cleanup decides 'these two helpers handle detached identically' and unifies the
		// policy in either direction, ONE of the two suites will fail loudly. Keep both pinned.
		const meta: GraphWipRowsById = { 'wip::/detached': wipRow('detached', 'sha1') };
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', refsFor(branchRef));
		assert.strictEqual(result, meta, 'detached entry passes through unchanged under visibility-only');
	});
});

suite('isScopeFocalHead', () => {
	const headRow = { heads: [{ name: 'focal', isCurrentHead: true }] };
	const plainRow = { heads: [{ name: 'focal', isCurrentHead: false }] };
	const otherRow = { heads: [{ name: 'other', isCurrentHead: true }] };
	const bareRow = {};

	test('true when the focal branch tip row is also HEAD', () => {
		assert.strictEqual(isScopeFocalHead([bareRow, headRow], scopeFor('/repo|heads/focal')), true);
	});

	test('false when the focal branch tip row is loaded but is not HEAD', () => {
		assert.strictEqual(isScopeFocalHead([otherRow, plainRow], scopeFor('/repo|heads/focal')), false);
	});

	test('false when the focal tip row carries no isCurrentHead flag at all', () => {
		assert.strictEqual(isScopeFocalHead([{ heads: [{ name: 'focal' }] }], scopeFor('/repo|heads/focal')), false);
	});

	test("undefined when nothing is loaded that can answer — 'can't tell', not 'isn't HEAD'", () => {
		// The distinction that matters: answering `false` here would hide the WIP row for the very
		// case the whole fix exists for (scoped to the current branch, tip not yet paged in).
		assert.strictEqual(
			isScopeFocalHead(
				[bareRow, { heads: [{ name: 'other', isCurrentHead: false }] }],
				scopeFor('/repo|heads/focal'),
			),
			undefined,
		);
	});

	test("false when the focal tip isn't loaded but another row IS HEAD", () => {
		// A loaded row claiming HEAD is proof enough that the unloaded focal branch isn't it. Returning
		// `undefined` here let the caller default to showing, leaking the current branch's working
		// changes under a scope they don't belong to.
		assert.strictEqual(isScopeFocalHead([bareRow, otherRow], scopeFor('/repo|heads/focal')), false);
	});

	test('reads the FOCAL head, not any head sharing its row', () => {
		// `main` and `focal` on the same commit: `main` is HEAD, the scope is on `focal`. Asking "is any
		// head on this row current" answers for `main` and hands `main`'s working changes to `focal`.
		const sharedTip = {
			heads: [
				{ name: 'main', isCurrentHead: true },
				{ name: 'focal', isCurrentHead: false },
			],
		};
		assert.strictEqual(isScopeFocalHead([sharedTip], scopeFor('/repo|heads/focal')), false);
		assert.strictEqual(isScopeFocalHead([sharedTip], scopeFor('/repo|heads/main')), true);
	});

	test('undefined when there is no scope or no rows', () => {
		assert.strictEqual(isScopeFocalHead([headRow], undefined), undefined);
		assert.strictEqual(isScopeFocalHead(undefined, scopeFor('/repo|heads/focal')), undefined);
	});
});

suite('shouldShowPrimaryWipRow', () => {
	const currentBranchId = '/repo|heads/feature';
	const currentBranch = branchFor(currentBranchId);
	// What `GitBranch` actually produces for a detached HEAD: the id is keyed by SHA (not by name),
	// the name is the synthesized `(sha…)` label, and `detached` is set. The guard reads the FLAG —
	// see the `(release)` test below for why the name can't stand in for it.
	const detachedBranch = { id: '/repo|heads/1a2b3c4d5e6f7a8b', name: '(1a2b3c4...)', detached: true };

	test("returns true when branchesVisibility is 'all'", () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', refsFor('/repo|heads/other'), currentBranch, undefined),
			true,
		);
	});

	test('returns true when branchesVisibility is undefined', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow(undefined, refsFor('/repo|heads/other'), currentBranch, undefined),
			true,
		);
	});

	test('returns true when includeOnlyRefs is undefined', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('agents', undefined, currentBranch, undefined), true);
	});

	test('returns true when includeOnlyRefs is empty {} (no-filter sentinel)', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('smart', {}, currentBranch, undefined), true);
	});

	test('returns true when currentBranchId is in the include set', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('agents', refsFor(currentBranchId), currentBranch, undefined), true);
	});

	test('returns false when currentBranchId is not in the include set (agents mode w/ no agent on current)', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('agents', refsFor('/repo|heads/other'), currentBranch, undefined),
			false,
		);
	});

	test('returns false when only the empty-set marker is present', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow(
				'agents',
				{ ['gk.empty-set-marker' satisfies typeof emptySetMarker]: {} as unknown as GraphIncludeOnlyRef },
				currentBranch,
				undefined,
			),
			false,
		);
	});

	test('returns true when the current branch is unknown', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('agents', refsFor('/repo|heads/other'), undefined, undefined), true);
	});

	test("returns false when scope's focal branch isn't HEAD (descendant scope leak repro)", () => {
		// Pin with branchesVisibility === 'all' so a regression in guard ordering re-introduces
		// the leak Eric reported (primary WIP appearing under a descendant branch's scope).
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', undefined, currentBranch, scopeFor('/repo|heads/descendant')),
			false,
		);
	});

	test('returns true when scope is undefined (no scope active)', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('all', undefined, currentBranch, undefined), true);
	});

	test('returns true when scope.branchRef equals currentBranchId', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('all', undefined, currentBranch, scopeFor(currentBranchId)), true);
	});

	test('returns false when scope is active and HEAD is detached', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', undefined, detachedBranch, scopeFor('/repo|heads/anything')),
			false,
		);
	});

	test('returns false when scope is active and HEAD is detached even if branchRef matches its id', () => {
		// A detached id is SHA-keyed, so nothing normally builds a matching `branchRef` — but the
		// hide must come from the detached NAME, not from the mismatch happening to fire.
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', undefined, detachedBranch, scopeFor(detachedBranch.id)),
			false,
		);
	});

	test('a parenthesized branch name is NOT treated as detached', () => {
		// The old `isDetachedHead` matched any `(…)` name, but `(release)` is a legal git branch (verified with
		// `git check-ref-format --branch`). Using that test here locked such a branch out of being
		// focused and hid its WIP row, so the guard reads the host's resolved `detached` flag instead.
		const parenBranch = { id: '/repo|heads/(release)', name: '(release)', detached: false };
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', undefined, parenBranch, scopeFor('/repo|heads/(release)')),
			true,
		);
	});

	test('returns true when scope is active but the current branch is unknown and the rows cannot tell', () => {
		// Regression guard: `state.branch` only ships on full-state pushes and is written through
		// unguarded, so an errored `getBranch()` sends `branch: undefined` while the webview-local
		// `scope` stays put. Treating that as a mismatch deleted the WIP row until the next full
		// state — and ONLY while scoped, which is what made it look intermittent.
		assert.strictEqual(shouldShowPrimaryWipRow('all', undefined, undefined, scopeFor('/repo|heads/focal')), true);
	});

	test('unknown branch + rows say the focal tip IS HEAD → show', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', undefined, undefined, scopeFor('/repo|heads/focal'), true),
			true,
		);
	});

	test('unknown branch + rows say the focal tip is NOT HEAD → hide', () => {
		// Without this the transient showed the current branch's WIP under an unrelated scoped branch —
		// the descendant-scope leak, just via a missing branch instead of a mismatched one. The rows
		// answer the question the branch id was only ever a proxy for.
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', undefined, undefined, scopeFor('/repo|heads/focal'), false),
			false,
		);
	});

	test('a known branch ignores the rows-derived signal', () => {
		// The branch payload is authoritative when present; `scopeFocalIsHead` is strictly a fallback.
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', undefined, currentBranch, scopeFor('/repo|heads/other'), true),
			false,
		);
	});

	test('returns false when current is in scope.additionalBranchRefs but not scope.branchRef', () => {
		// Pins the "additionalBranchRefs doesn't count" convention so a future broadening fails
		// loudly — primary WIP attributes only to the focal branch (`scope.branchRef`).
		assert.strictEqual(
			shouldShowPrimaryWipRow(
				'all',
				undefined,
				currentBranch,
				scopeFor('/repo|heads/focal', { additionalBranchRefs: [currentBranchId] }),
			),
			false,
		);
	});

	test('scope guard precedes branchesVisibility — agents mode with off-scope focal still hides', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('agents', refsFor(currentBranchId), currentBranch, scopeFor('/repo|heads/other')),
			false,
		);
	});

	test('focusing the current branch outranks branchesVisibility', () => {
		// Focus is explicit intent; `branchesVisibility` is an implicit filter. Without this, focusing
		// your own branch under `agents` mode still hid your working changes whenever no agent happened
		// to be running on it — and the include set is idle-threshold driven, so it lapsed on a timer.
		// Matches the exemption `filterSecondariesForScopeAndVisibility` already gives worktree rows.
		assert.strictEqual(
			shouldShowPrimaryWipRow('agents', refsFor('/repo|heads/other'), currentBranch, scopeFor(currentBranchId)),
			true,
		);
	});

	test('focus outranks branchesVisibility on the rows-derived path too', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('agents', refsFor('/repo|heads/other'), undefined, scopeFor(currentBranchId), true),
			true,
		);
	});

	test('an unestablished focal (rows cannot tell) does NOT short-circuit visibility', () => {
		// Focus only wins once focal === current is actually established. Here it isn't, so the
		// visibility checks still run — they happen to pass on the unknown-branch fallback, but the
		// point is that the short-circuit didn't fire.
		assert.strictEqual(
			shouldShowPrimaryWipRow('agents', refsFor('/repo|heads/other'), undefined, scopeFor(currentBranchId)),
			true,
		);
	});
});

suite('filterSecondariesForScopeAndVisibility', () => {
	const scopedRef = '/repo|heads/main';
	const otherRef = '/repo|heads/other';

	test('without scope, applies the visibility filter', () => {
		// Mirrors `filterSecondariesForIncludeOnlyRefs` behavior — entries not in `includeOnlyRefs` drop.
		const meta: GraphWipRowsById = {
			'wip::/a': wipRow('a', 'sha1', scopedRef),
			'wip::/b': wipRow('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForScopeAndVisibility(meta, undefined, 'agents', refsFor(scopedRef));
		assert.ok(result?.['wip::/a']);
		assert.strictEqual(result?.['wip::/b'], undefined);
	});

	test('with scope, skips the visibility filter — scoped entry survives even when missing from includeOnlyRefs', () => {
		// Pins the bug fix: scoping the graph from a `gitlens-debug` worktree to the `main` worktree's
		// branch under `'current'`/`'agents'`/`'favorited'` modes — `main` isn't in `includeOnlyRefs`
		// (which is anchored on the open repo's HEAD, the debug branch), but the user's explicit scope
		// pick should override and keep `main`'s secondary WIP visible.
		const meta: GraphWipRowsById = {
			'wip::/main': wipRow('main', 'sha1', scopedRef),
			'wip::/other': wipRow('other', 'sha2', otherRef),
		};
		const result = filterSecondariesForScopeAndVisibility(
			meta,
			scopeFor(scopedRef),
			'current',
			refsFor('/repo|heads/debug'),
		);
		assert.ok(result?.['wip::/main'], 'scoped entry survives despite visibility filter');
		assert.strictEqual(result?.['wip::/other'], undefined, 'non-scoped entry dropped by scope filter');
	});

	test('with scope, off-scope entries are still dropped by the scope filter', () => {
		const meta: GraphWipRowsById = {
			'wip::/main': wipRow('main', 'sha1', scopedRef),
			'wip::/other': wipRow('other', 'sha2', otherRef),
		};
		const result = filterSecondariesForScopeAndVisibility(meta, scopeFor(scopedRef), 'all', undefined);
		assert.ok(result?.['wip::/main']);
		assert.strictEqual(result?.['wip::/other'], undefined);
	});

	test('with scope on `all` visibility, scoped entry survives (no filter applied)', () => {
		const meta: GraphWipRowsById = { 'wip::/main': wipRow('main', 'sha1', scopedRef) };
		const result = filterSecondariesForScopeAndVisibility(meta, scopeFor(scopedRef), 'all', undefined);
		assert.ok(result?.['wip::/main']);
	});

	test('without scope and `all` visibility, returns input unchanged', () => {
		const meta: GraphWipRowsById = {
			'wip::/a': wipRow('a', 'sha1', scopedRef),
			'wip::/b': wipRow('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForScopeAndVisibility(meta, undefined, 'all', undefined);
		assert.strictEqual(result, meta);
	});

	test('returns undefined when metadata is undefined', () => {
		const result = filterSecondariesForScopeAndVisibility(
			undefined,
			scopeFor(scopedRef),
			'current',
			refsFor(scopedRef),
		);
		assert.strictEqual(result, undefined);
	});

	test('with scope, drops detached worktree entries (branchRef undefined)', () => {
		// Regression guard at the COMPOSER level — if a future refactor swaps the order or
		// short-circuits the inner helpers, the inner-helper test alone wouldn't catch it.
		const meta: GraphWipRowsById = {
			'wip::/main': wipRow('main', 'sha1', scopedRef),
			'wip::/detached': wipRow('detached', 'sha2'),
		};
		const result = filterSecondariesForScopeAndVisibility(meta, scopeFor(scopedRef), 'all', undefined);
		assert.ok(result?.['wip::/main'], 'scoped entry kept');
		assert.strictEqual(result?.['wip::/detached'], undefined, 'detached dropped under scope');
	});

	test('without scope, keeps detached worktree entries under visibility-only mode', () => {
		// Mirror pin for the no-scope branch — the visibility helper's keep-detached policy
		// must survive at the composer level too.
		const meta: GraphWipRowsById = {
			'wip::/a': wipRow('a', 'sha1', scopedRef),
			'wip::/detached': wipRow('detached', 'sha2'),
		};
		const result = filterSecondariesForScopeAndVisibility(meta, undefined, 'agents', refsFor(scopedRef));
		assert.ok(result?.['wip::/a']);
		assert.ok(result?.['wip::/detached'], 'detached kept under visibility-only');
	});
});

function refsFor(...ids: string[]): GraphIncludeOnlyRefs {
	const result: GraphIncludeOnlyRefs = {};
	for (const id of ids) {
		// Parse '{repoPath}|heads/{name}' into name + type; simple split-based parser to
		// keep the test fixture free of complex regex APIs.
		const pipe = id.indexOf('|');
		const remainder = pipe >= 0 ? id.slice(pipe + 1) : id;
		const slash = remainder.indexOf('/');
		const type = (slash >= 0 ? remainder.slice(0, slash) : 'heads') as GraphIncludeOnlyRef['type'];
		const name = slash >= 0 ? remainder.slice(slash + 1) : remainder;
		result[id] = { id: id, name: name, type: type };
	}
	return result;
}

/** The `{ id, name }` current-branch shape `shouldShowPrimaryWipRow` takes, with the name derived
 *  from the ref id's tail (`'{repoPath}|heads/{name}'`) the way a non-detached branch pairs them. */
function branchFor(id: string): { id: string; name: string } {
	const slash = id.lastIndexOf('/');
	return { id: id, name: slash >= 0 ? id.slice(slash + 1) : id };
}

function scopeFor(branchRef: string, opts?: { additionalBranchRefs?: string[] }): GraphScope {
	// `branchName` is required on GraphScope; derive a sensible default from the ref id's tail
	// (mirrors how the host populates it). The tests don't read this field — `shouldShowPrimaryWipRow`
	// only consults `branchRef` — but it must be present to type-check.
	const slash = branchRef.lastIndexOf('/');
	const branchName = slash >= 0 ? branchRef.slice(slash + 1) : branchRef;
	return {
		branchName: branchName,
		branchRef: branchRef,
		...(opts?.additionalBranchRefs ? { additionalBranchRefs: opts.additionalBranchRefs } : {}),
	};
}

suite('getOverviewBranchSelectionSha', () => {
	const repoPath = '/repo';
	const branchId = `${repoPath}|heads/feature`;
	const tipSha = '1111111111111111111111111111111111111111';
	const otherSha = '2222222222222222222222222222222222222222';

	function branchFor(overrides: Partial<SelectionBranch> = {}): SelectionBranch {
		return {
			id: branchId,
			repoPath: repoPath,
			opened: false,
			reference: { sha: tipSha },
			...overrides,
		};
	}

	function ctxFor(overrides: Partial<SelectionContext> = {}): SelectionContext {
		return {
			wipRowsById: undefined,
			primaryWipRowId: undefined,
			rows: undefined,
			branchesVisibility: 'all',
			includeOnlyRefs: undefined,
			scope: undefined,
			// The cascade's case 3 now asks `shouldShowPrimaryWipRow` directly, which answers for the
			// branch HEAD points at — so the default pairs with `branchFor()`'s id, i.e. the picked
			// branch IS the current one. Only read when the picked branch is `opened`.
			currentBranch: { id: branchId, name: 'feature' },
			...overrides,
		};
	}

	function row(sha: string): GitGraphRow {
		// Only `sha` is read by `getOverviewBranchSelectionSha` (via the `loadedShas` Set);
		// other fields are filled in as no-op defaults that satisfy GitGraphRow's type.
		const r: GitGraphRow = {
			sha: sha,
			parents: [],
			author: '',
			email: '',
			date: 0,
			message: '',
			kind: 'commit',
			heads: [],
			remotes: [],
			tags: [],
		};
		return r;
	}

	test('case 1: secondary worktree on different path + parent in loaded rows → worktree WIP sha', () => {
		const wipMeta: GraphWipRowsById = { 'wip::/wt': wipRow('feature', tipSha, branchId) };
		const result = getOverviewBranchSelectionSha(
			branchFor({ worktree: { path: '/wt' } }),
			ctxFor({ wipRowsById: wipMeta, rows: [row(tipSha)] }),
		);
		assert.strictEqual(result, 'wip::/wt');
	});

	test('case 1: worktree exists but metadata is missing → falls through (does NOT return unselectable WIP)', () => {
		// Regression guard: the prior `meta == null` short-circuit silently returned an
		// unselectable WIP sha. Cold-metadata path should NOT short-circuit.
		const result = getOverviewBranchSelectionSha(
			branchFor({ worktree: { path: '/wt' } }),
			ctxFor({ wipRowsById: undefined, rows: [row(tipSha)] }),
		);
		assert.strictEqual(result, tipSha, 'fell through to tip when metadata was cold');
	});

	test('case 1: worktree + metadata present but parent NOT in loaded rows → falls through', () => {
		const wipMeta: GraphWipRowsById = { 'wip::/wt': wipRow('feature', otherSha, branchId) };
		const result = getOverviewBranchSelectionSha(
			branchFor({ worktree: { path: '/wt' } }),
			ctxFor({ wipRowsById: wipMeta, rows: [row(tipSha)] }),
		);
		assert.strictEqual(result, tipSha, 'parent not in loaded rows → tip');
	});

	test('case 2: default-worktree fallback via wipRowsById branchRef match', () => {
		// OverviewBranch.worktree is undefined (default-worktree strip at provider boundary),
		// but wipRowsById has an entry whose branchRef matches branch.id. Should select WIP.
		const wipMeta: GraphWipRowsById = { 'wip::/default': wipRow('feature', tipSha, branchId) };
		const result = getOverviewBranchSelectionSha(
			branchFor({ worktree: undefined }),
			ctxFor({ wipRowsById: wipMeta, rows: [row(tipSha)] }),
		);
		assert.strictEqual(result, 'wip::/default');
	});

	test('case 2: parent NOT in loaded rows → falls through', () => {
		const wipMeta: GraphWipRowsById = { 'wip::/default': wipRow('feature', otherSha, branchId) };
		const result = getOverviewBranchSelectionSha(
			branchFor(),
			ctxFor({ wipRowsById: wipMeta, rows: [row(tipSha)] }),
		);
		assert.strictEqual(result, tipSha);
	});

	test('case 3: branch.opened under `all` visibility → uncommitted', () => {
		const result = getOverviewBranchSelectionSha(
			branchFor({ opened: true }),
			ctxFor({ branchesVisibility: 'all' }),
		);
		assert.strictEqual(result, uncommitted);
	});

	test("case 3: branch.opened under 'agents' visibility but branchId in includeOnlyRefs → uncommitted", () => {
		const result = getOverviewBranchSelectionSha(
			branchFor({ opened: true }),
			ctxFor({ branchesVisibility: 'agents', includeOnlyRefs: refsFor(branchId) }),
		);
		assert.strictEqual(result, uncommitted);
	});

	test("case 3: UNSCOPED, branch.opened under 'agents' visibility BUT branchId NOT in includeOnlyRefs → tip (regression guard)", () => {
		// Without this gate the helper would return `uncommitted` and `ensureAndSelectCommit`
		// would retry 10 RAFs against a primary WIP row the wrapper never injected. Unscoped only —
		// with a scope on this branch, focus outranks visibility and the row DOES render (below).
		const result = getOverviewBranchSelectionSha(
			branchFor({ opened: true }),
			ctxFor({ branchesVisibility: 'agents', includeOnlyRefs: refsFor('/repo|heads/other') }),
		);
		assert.strictEqual(result, tipSha);
	});

	test("case 3: SCOPED to the opened branch under 'agents' with branchId NOT in includeOnlyRefs → uncommitted", () => {
		// Focus outranks `branchesVisibility` (`shouldShowPrimaryWipRow`'s short-circuit), so the
		// wrapper renders the primary WIP row and the selection must land on it — not the tip.
		const result = getOverviewBranchSelectionSha(
			branchFor({ opened: true }),
			ctxFor({
				branchesVisibility: 'agents',
				includeOnlyRefs: refsFor('/repo|heads/other'),
				scope: scopeFor(branchId),
			}),
		);
		assert.strictEqual(result, uncommitted);
	});

	test('case 3: SCOPED to ANOTHER branch → tip even under `all` visibility', () => {
		// A foreign scope always hides the primary WIP row (the scope gate), so `uncommitted`
		// would be unselectable — fall to the tip.
		const result = getOverviewBranchSelectionSha(
			branchFor({ opened: true }),
			ctxFor({ branchesVisibility: 'all', scope: scopeFor('/repo|heads/other') }),
		);
		assert.strictEqual(result, tipSha);
	});

	test('case 4: not opened, no worktree match, no wipMeta match → branch tip', () => {
		const result = getOverviewBranchSelectionSha(branchFor(), ctxFor());
		assert.strictEqual(result, tipSha);
	});

	test('case 4: undefined rows means we cannot gate on parentSha — case 1 still returns WIP', () => {
		const wipMeta: GraphWipRowsById = { 'wip::/wt': wipRow('feature', otherSha, branchId) };
		const result = getOverviewBranchSelectionSha(
			branchFor({ worktree: { path: '/wt' } }),
			ctxFor({ wipRowsById: wipMeta, rows: undefined }),
		);
		assert.strictEqual(result, 'wip::/wt', 'no rows info → trust metadata');
	});
});

suite('shouldRestoreSearchQuery', () => {
	test('restores when the box is empty and a query + results are present', () => {
		assert.strictEqual(shouldRestoreSearchQuery('', { query: 'foo' }, true, false), true);
		assert.strictEqual(shouldRestoreSearchQuery(undefined, { query: 'foo' }, true, false), true);
	});

	test('restores mid-progressive-search before the first result (searching, no results yet)', () => {
		// Without this, a rebooted iframe shows a spinner over a blank box until the first result lands.
		assert.strictEqual(shouldRestoreSearchQuery('', { query: 'foo' }, false, true), true);
	});

	test('never clobbers an in-progress user query', () => {
		assert.strictEqual(shouldRestoreSearchQuery('typing', { query: 'foo' }, true, true), false);
	});

	test('does not fire when the search is dead (no results and not searching — avoids reviving a cancelled search)', () => {
		assert.strictEqual(shouldRestoreSearchQuery('', { query: 'foo' }, false, false), false);
	});

	test('does not fire with no/empty restored query', () => {
		assert.strictEqual(shouldRestoreSearchQuery('', undefined, true, true), false);
		assert.strictEqual(shouldRestoreSearchQuery('', { query: '' }, true, true), false);
	});
});

suite('countLoadedSearchResults', () => {
	function results(ids: Record<string, { i: number; date: number }>): GraphSearchResults {
		return { ids: ids, count: Object.keys(ids).length, hasMore: false };
	}

	test('undefined results → 0', () => {
		assert.strictEqual(countLoadedSearchResults(undefined, new Set(['a'])), 0);
	});

	test('an error envelope → 0', () => {
		const error: GraphSearchResultsError = { error: 'Invalid search pattern' };
		assert.strictEqual(countLoadedSearchResults(error, new Set(['a'])), 0);
	});

	test('empty ids → 0', () => {
		assert.strictEqual(countLoadedSearchResults(results({}), new Set(['a'])), 0);
	});

	test('every result sha present in rows → the full count', () => {
		const sr = results({ a: { i: 0, date: 0 }, b: { i: 1, date: 0 } });
		assert.strictEqual(countLoadedSearchResults(sr, new Set(['a', 'b', 'c'])), 2);
	});

	test('a mix of loaded and unloaded shas → only the loaded ones', () => {
		const sr = results({ a: { i: 0, date: 0 }, b: { i: 1, date: 0 }, c: { i: 2, date: 0 } });
		assert.strictEqual(countLoadedSearchResults(sr, new Set(['a'])), 1);
	});

	test('WIP row ids count as loaded even when absent from rows', () => {
		const wip1 = createWipRowId('/repo');
		const wip2 = createWipRowId('/repo2');
		const sr = results({ [wip1]: { i: 0, date: 0 }, [wip2]: { i: 1, date: 0 }, a: { i: 2, date: 0 } });
		assert.strictEqual(countLoadedSearchResults(sr, new Set(['a'])), 3);
	});

	test('no rows loaded → only WIP ids count', () => {
		const wip1 = createWipRowId('/repo');
		const sr = results({ [wip1]: { i: 0, date: 0 }, a: { i: 1, date: 0 } });
		assert.strictEqual(countLoadedSearchResults(sr, new Set()), 1);
	});
});

suite('countRenderedSearchResults', () => {
	function results(ids: Record<string, { i: number; date: number }>): GraphSearchResults {
		return { ids: ids, count: Object.keys(ids).length, hasMore: false };
	}

	test('undefined results → 0', () => {
		assert.strictEqual(countRenderedSearchResults(undefined, new Set(['a'])), 0);
	});

	test('an error envelope → 0', () => {
		const error: GraphSearchResultsError = { error: 'Invalid search pattern' };
		assert.strictEqual(countRenderedSearchResults(error, new Set(['a'])), 0);
	});

	test('empty ids → 0', () => {
		assert.strictEqual(countRenderedSearchResults(results({}), new Set(['a'])), 0);
	});

	test('a mix of rendered and unrendered shas → only the rendered ones', () => {
		const sr = results({ a: { i: 0, date: 0 }, b: { i: 1, date: 0 }, c: { i: 2, date: 0 } });
		assert.strictEqual(countRenderedSearchResults(sr, new Set(['a'])), 1);
	});

	// The regression this function exists for: `countLoadedSearchResults` exempts every WIP id, so a
	// `type:wip` search over a many-worktree repo reported all of them as loaded while only the few whose
	// anchor commit had paged in were on screen.
	test('a peer WIP id absent from the decorated rows does NOT count', () => {
		const anchored = createWipRowId('/repo/wt-anchored');
		const unanchored = createWipRowId('/repo/wt-unanchored');
		const sr = results({ [anchored]: { i: 0, date: 0 }, [unanchored]: { i: 1, date: 0 } });
		assert.strictEqual(countRenderedSearchResults(sr, new Set([anchored])), 1);
	});

	test('the primary WIP id follows the same rule as any other row', () => {
		const primary = createWipRowId('/repo');
		const sr = results({ [primary]: { i: 0, date: 0 }, a: { i: 1, date: 0 } });
		assert.strictEqual(countRenderedSearchResults(sr, new Set([primary, 'a'])), 2);
		assert.strictEqual(countRenderedSearchResults(sr, new Set(['a'])), 1);
	});

	test('accepts the decorated-rows index Map, not just a Set', () => {
		const wip = createWipRowId('/repo');
		const sr = results({ [wip]: { i: 0, date: 0 }, a: { i: 1, date: 0 }, b: { i: 2, date: 0 } });
		const indexBySha = new Map<string, number>([
			[wip, 0],
			['a', 1],
		]);
		assert.strictEqual(countRenderedSearchResults(sr, indexBySha), 2);
	});
});

suite('resolveFullStateWorkingTreeStats', () => {
	test('drops and keeps ownership when the wip channel owns the incoming repo', () => {
		// Steady-state protection AND early swap-delivery retention: a B tick (even one that arrived while the
		// client still showed A) stamped _wipStatsRowId = B, so B's own full-state drops its older seed.
		assert.deepStrictEqual(resolveFullStateWorkingTreeStats('/b', '/b'), { seed: false, wipStatsRowId: '/b' });
	});

	test('seeds and clears ownership when the wip channel owns a different repo', () => {
		assert.deepStrictEqual(resolveFullStateWorkingTreeStats('/b', '/a'), { seed: true, wipStatsRowId: undefined });
	});

	test('seeds before the wip channel has written any stats', () => {
		assert.deepStrictEqual(resolveFullStateWorkingTreeStats('/a', undefined), {
			seed: true,
			wipStatsRowId: undefined,
		});
	});

	test('seeds when the incoming repo is absent', () => {
		assert.deepStrictEqual(resolveFullStateWorkingTreeStats(undefined, '/a'), {
			seed: true,
			wipStatsRowId: undefined,
		});
	});

	test('B-WIP → A-full-state → B-full-state re-seeds B (swap-back regression)', () => {
		// A B working-tree tick stamped ownership = B.
		let owner: string | undefined = '/b';
		// Swap B→A: A's full-state seeds and must CLEAR the stale B marker.
		let r = resolveFullStateWorkingTreeStats('/a', owner);
		assert.deepStrictEqual(r, { seed: true, wipStatsRowId: undefined });
		owner = r.wipStatsRowId;
		// Swap back A→B on an idle B (no tick): B's full-state must RE-SEED, not be dropped by a stale marker.
		r = resolveFullStateWorkingTreeStats('/b', owner);
		assert.strictEqual(r.seed, true, 'B full-state must re-seed after swap-back');
	});
});

suite('GraphStateProvider pendingScopeToBranch cancellation', () => {
	const proto = GraphStateProvider.prototype;

	function createFakeThis(): GraphStateProvider {
		const fake = Object.create(proto) as GraphStateProvider;
		fake.scope = undefined;
		fake.pendingScopeToBranch = true;
		return fake;
	}

	teardown(() => {
		const t = createFakeThis();
		t.scope = undefined;
		t.pendingScopeToBranch = false;
	});

	test('clearScope cancels the park even when no scope is published', () => {
		const t = createFakeThis();
		proto.clearScope.call(t);

		assert.strictEqual(t.pendingScopeToBranch, false);
	});

	test('setScope cancels the park', async () => {
		const t = createFakeThis();
		await proto.setScope.call(t, { branchRef: '', branchName: '' });

		assert.strictEqual(t.pendingScopeToBranch, false);
	});

	test('deferScopeClear cancels the park even when no scope is published', () => {
		const t = createFakeThis();
		proto.deferScopeClear.call(t);

		assert.strictEqual(t.pendingScopeToBranch, false);
	});
});

suite('GraphStateProvider clearScope — cancels an in-flight pick even with nothing published yet', () => {
	// Pins the pill-✕-mid-resolve race: a worktree gesture's anchor IPC can still be resolving (no
	// `this.scope` published yet) when the user asks for a full exit. Before this fix, `clearScope`
	// early-returned on `this.scope == null` WITHOUT cancelling `_pendingScope`, so
	// `publishResolvedScope` would install the scope moments later — after the user already left.
	const proto = GraphStateProvider.prototype;
	const protoUnsafe = proto as unknown as {
		publishResolvedScope: (this: GraphStateProvider, scope: GraphScope, anchor: undefined) => void;
	};

	function priv(t: GraphStateProvider): Record<string, unknown> {
		return t as unknown as Record<string, unknown>;
	}

	function createFakeThis(): GraphStateProvider {
		const fake = Object.create(proto) as GraphStateProvider;
		fake.scope = undefined;
		fake.pendingScopeToBranch = false;
		return fake;
	}

	test('cancels a pending scope pick with no published scope and no host/telemetry call', () => {
		const t = createFakeThis();
		priv(t)._pendingScope = { branchRef: '/wt|heads/feature', branchName: 'feature' } satisfies GraphScope;
		t.scopeLoading = true;
		// No `host` stub seeded — if `clearScope` incorrectly reached the telemetry emission (it must
		// only fire when a PUBLISHED scope is actually cleared), calling `.dispatchEvent` on `undefined`
		// would throw and fail this test.

		proto.clearScope.call(t);

		assert.strictEqual(priv(t)._pendingScope, undefined, 'the in-flight pick must be cancelled');
		assert.strictEqual(t.scopeLoading, false);
	});

	test('a scope that resolves AFTER clearScope no longer publishes (publishResolvedScope bails on the stale pick)', () => {
		const t = createFakeThis();
		const scope = { branchRef: '/wt|heads/feature', branchName: 'feature' } satisfies GraphScope;
		priv(t)._pendingScope = scope;

		proto.clearScope.call(t);
		// Simulates the anchor IPC landing after the user already asked to leave.
		protoUnsafe.publishResolvedScope.call(t, scope, undefined);

		assert.strictEqual(t.scope, undefined, 'a superseded resolve must not publish');
	});
});

suite('GraphStateProvider — worktree perspective rebind side-channel', () => {
	const proto = GraphStateProvider.prototype;

	function priv(t: GraphStateProvider): Record<string, unknown> {
		return t as unknown as Record<string, unknown>;
	}

	/** Records every `GraphScopeService.rebind` call the fake's `_scopeService` receives, and every
	 *  `gl-graph-request-rebind-failed` message the provider dispatches for them.
	 *
	 *  `refused` is the host's refusal REASON (`'not-ready'` is the only retryable one) — pass `undefined`
	 *  for an accepted rebind. NOTE: deliberately NOT a defaulted-to-accepted parameter, since a default
	 *  substitutes on an explicit `undefined` argument too, which would silently turn an intended refusal
	 *  into an acceptance. */
	function createFakeThis(refused?: GraphRebindRefusalReason): {
		t: GraphStateProvider;
		rebindCalls: { worktreePath: string | undefined }[];
		failureMessages: string[];
	} {
		const rebindCalls: { worktreePath: string | undefined }[] = [];
		const failureMessages: string[] = [];
		const fake = Object.create(proto) as GraphStateProvider;
		fake.scope = undefined;
		fake.worktreePerspective = undefined;
		fake.pendingScopeToBranch = false;
		fake.repositories = undefined;
		priv(fake)._mergeBaseCache = new Map<string, ResolvedScopeAnchor | undefined>();
		priv(fake).host = {
			dispatchEvent: (e: CustomEvent<{ message: string }>) => {
				if (e.type === 'gl-graph-request-rebind-failed') {
					failureMessages.push(e.detail.message);
				}
				return true;
			},
		};
		priv(fake).logger = { debug: () => {} };
		// `reconcileWorktreeRebind` awaits `_servicesReady.promise` before touching `_scopeService`, the
		// same pattern `fetchScopeAnchor` uses — an already-resolved promise here means the mock is
		// reachable without a real RPC handshake.
		priv(fake)._servicesReady = { promise: Promise.resolve() };
		priv(fake)._scopeService = {
			rebind: (params: { worktreePath: string | undefined }) => {
				rebindCalls.push(params);
				return Promise.resolve(
					refused != null ? { refused: refused } : { repoPath: '/wt', previousRepoPath: '/home' },
				);
			},
		};
		return { t: fake, rebindCalls: rebindCalls, failureMessages: failureMessages };
	}

	/** `reconcileWorktreeRebind`'s call is fire-and-forget off a `_servicesReady.promise.then(() =>
	 *  rebind(...)).then(result => ...)` chain — the mock `rebind()` itself returns a resolved promise,
	 *  so settling the whole chain takes more than one microtask turn. A macrotask boundary drains every
	 *  pending microtask first, so it's used here instead of counting `.then()` hops by hand. */
	function flush(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 0));
	}

	test('setWorktreePerspective fires rebind with the worktree path', async () => {
		const { t, rebindCalls } = createFakeThis();

		proto.setWorktreePerspective.call(t, '/wt');
		await flush();

		assert.deepStrictEqual(rebindCalls, [{ worktreePath: '/wt' }]);
		assert.deepStrictEqual(t.worktreePerspective, { path: '/wt', branchName: undefined });
	});

	test('setWorktreePerspective carries the optimistic branch name', async () => {
		const { t, rebindCalls } = createFakeThis();

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'feature' });
		await flush();

		assert.deepStrictEqual(rebindCalls, [{ worktreePath: '/wt' }]);
		assert.deepStrictEqual(t.worktreePerspective, { path: '/wt', branchName: 'feature' });
	});

	test('clearWorktreePerspective fires rebind(undefined) and clears the field', async () => {
		const { t, rebindCalls } = createFakeThis();
		t.worktreePerspective = { path: '/wt', branchName: 'feature' };

		proto.clearWorktreePerspective.call(t);
		await flush();

		assert.deepStrictEqual(rebindCalls, [{ worktreePath: undefined }]);
		assert.strictEqual(t.worktreePerspective, undefined);
	});

	test('clearWorktreePerspective is a no-op when nothing is perspectived — no rebind fires', async () => {
		const { t, rebindCalls } = createFakeThis();

		proto.clearWorktreePerspective.call(t);
		await flush();

		assert.deepStrictEqual(rebindCalls, []);
	});

	test('the same worktree path is a no-op — no rebind fires', async () => {
		const { t, rebindCalls } = createFakeThis();
		t.worktreePerspective = { path: '/wt', branchName: 'main' };

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'main' });
		await flush();

		assert.deepStrictEqual(rebindCalls, []);
	});

	test('the same worktree path still refreshes the optimistic branch name', async () => {
		const { t, rebindCalls } = createFakeThis();
		t.worktreePerspective = { path: '/wt', branchName: 'main' };

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'feature' });
		await flush();

		assert.deepStrictEqual(rebindCalls, []);
		assert.deepStrictEqual(t.worktreePerspective, { path: '/wt', branchName: 'feature' });
	});

	test('a different worktree rebinds straight to the new path (host serializes)', async () => {
		const { t, rebindCalls } = createFakeThis();
		t.worktreePerspective = { path: '/wt-a', branchName: 'main' };

		proto.setWorktreePerspective.call(t, '/wt-b', { branchName: 'main' });
		await flush();

		assert.deepStrictEqual(rebindCalls, [{ worktreePath: '/wt-b' }]);
		assert.deepStrictEqual(t.worktreePerspective, { path: '/wt-b', branchName: 'main' });
	});

	// A SET refused as `not-ready` is retried exactly once (UX review finding 4: the host may simply not
	// have a session yet — the cold-open race, not a genuine "can't") — it latches a retry and leaves the
	// OPTIMISTIC value in place. Only a refused RETRY (no cold-open excuse left) reverts.
	test("a SET refused as 'not-ready' latches a retry instead of reverting immediately", async () => {
		const { t, rebindCalls, failureMessages } = createFakeThis('not-ready');

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'main' });
		await flush();

		assert.deepStrictEqual(rebindCalls, [{ worktreePath: '/wt' }]);
		assert.deepStrictEqual(
			t.worktreePerspective,
			{ path: '/wt', branchName: 'main' },
			'a not-ready refusal may be a cold-open race — it latches a retry rather than reverting yet',
		);
		assert.notStrictEqual(priv(t)._pendingRebindRetry, undefined, 'a retry must be latched');
		assert.deepStrictEqual(failureMessages, [], 'nothing to report to the user while a retry is pending');
	});

	// The other half of the same rule, and the one that closes the pushless-refusal hole: a TERMINAL
	// refusal (nothing to rebind onto) can't be waited out, and the refusals most likely to produce no
	// state push at all are exactly these — so latching one would strand the titlebar tint, the ✕ and the
	// aria announcement on a graph that isn't scoped, indefinitely.
	test("a SET refused as 'unavailable' reverts IMMEDIATELY and reports it", async () => {
		const { t, rebindCalls, failureMessages } = createFakeThis('unavailable');

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'main' });
		await flush();

		assert.deepStrictEqual(rebindCalls, [{ worktreePath: '/wt' }]);
		assert.strictEqual(t.worktreePerspective, undefined, 'a terminal refusal must not leave a false scope');
		assert.strictEqual(priv(t)._pendingRebindRetry, undefined, 'nothing retryable — no latch');
		assert.strictEqual(failureMessages.length, 1, 'the user must be told the scope did not take');
	});

	test("a SET refused as 'failed' reverts immediately too", async () => {
		const { t, failureMessages } = createFakeThis('failed');

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'main' });
		await flush();

		assert.strictEqual(t.worktreePerspective, undefined);
		assert.strictEqual(failureMessages.length, 1);
	});

	// The graph is already bound to the requested worktree — e.g. "Scope to Worktree" on the sidebar row
	// for the worktree the header picker already switched to. It still reverts (no recorded home sits
	// behind that binding, so the ✕ would have nothing to return to), but reporting a FAILURE would be
	// false: the graph is showing exactly what the user asked for.
	test("a SET refused as 'already-bound' reverts SILENTLY", async () => {
		const { t, failureMessages } = createFakeThis('already-bound');

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'main' });
		await flush();

		assert.strictEqual(t.worktreePerspective, undefined, 'no false scoped state is left behind');
		assert.deepStrictEqual(failureMessages, [], 'nothing failed from the user’s point of view');
		assert.strictEqual(priv(t)._pendingRebindRetry, undefined, 'and there is nothing to retry');
	});

	test('a rebind RPC that THROWS reverts and reports, without latching a retry', async () => {
		const { t } = createFakeThis();
		const failureMessages: string[] = [];
		priv(t).host = {
			dispatchEvent: (e: CustomEvent<{ message: string }>) => {
				failureMessages.push(e.detail.message);
				return true;
			},
		};
		priv(t)._scopeService = { rebind: () => Promise.reject(new Error('boom')) };

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'main' });
		await flush();

		assert.strictEqual(t.worktreePerspective, undefined, 'a throw is not the cold-open race — revert');
		assert.strictEqual(priv(t)._pendingRebindRetry, undefined);
		assert.strictEqual(failureMessages.length, 1);
	});

	test('a refused retry reverts the perspective — no phantom perspective left behind', async () => {
		const { t } = createFakeThis('not-ready');
		// The optimistic value a latched first attempt would have left in place.
		t.worktreePerspective = { path: '/wt', branchName: 'main' };

		(priv(t).reconcileWorktreeRebind as (...args: unknown[]) => void).call(t, '/wt', undefined, true);
		await flush();

		assert.strictEqual(
			t.worktreePerspective,
			undefined,
			'a refused retry must revert — there is no cold-open excuse left',
		);
	});

	test("a SET refused as 'not-ready' from an already-live perspective latches a retry, keeping the OPTIMISTIC value", async () => {
		const { t, rebindCalls } = createFakeThis('not-ready');
		t.worktreePerspective = { path: '/wt-a', branchName: 'main' };

		proto.setWorktreePerspective.call(t, '/wt-b', { branchName: 'feature' });
		await flush();

		assert.deepStrictEqual(rebindCalls, [{ worktreePath: '/wt-b' }]);
		assert.deepStrictEqual(
			t.worktreePerspective,
			{ path: '/wt-b', branchName: 'feature' },
			'the first not-ready refusal latches a retry rather than reverting yet',
		);
	});

	test('a refused retry reverts to the previous LIVE perspective, not undefined', async () => {
		// wt-a → wt-b refused (on retry): the host never left wt-a, so the webview must keep showing
		// wt-a — falling back to "unscoped" here would desync the UI from the host's actual binding.
		const { t } = createFakeThis('not-ready');
		t.worktreePerspective = { path: '/wt-b', branchName: 'feature' };

		(priv(t).reconcileWorktreeRebind as (...args: unknown[]) => void).call(
			t,
			'/wt-b',
			{ path: '/wt-a', branchName: 'main' },
			true,
		);
		await flush();

		assert.deepStrictEqual(
			t.worktreePerspective,
			{ path: '/wt-a', branchName: 'main' },
			'a refused set must revert to the previous LIVE perspective, not fall back to unscoped',
		);
	});

	// A refused CLEAR is never latched for retry (only a SET is — see above): the host still has the
	// perspective bound, so the indicator must say so immediately rather than claim "unscoped" while
	// the graph is still showing the worktree (UX review finding 2).
	test('a refused CLEAR reverts to the previous perspective', async () => {
		const { t, rebindCalls, failureMessages } = createFakeThis('unavailable');
		t.worktreePerspective = { path: '/wt', branchName: 'main' };

		proto.clearWorktreePerspective.call(t);
		await flush();

		assert.deepStrictEqual(rebindCalls, [{ worktreePath: undefined }]);
		assert.deepStrictEqual(
			t.worktreePerspective,
			{ path: '/wt', branchName: 'main' },
			'the host never actually cleared it — the indicator must not claim otherwise',
		);
		assert.strictEqual(failureMessages.length, 1, 'and the user is told the unscope did not take');
	});

	test("a refused CLEAR is never latched, even as 'not-ready'", async () => {
		const { t } = createFakeThis('not-ready');
		t.worktreePerspective = { path: '/wt', branchName: 'main' };

		proto.clearWorktreePerspective.call(t);
		await flush();

		assert.strictEqual(priv(t)._pendingRebindRetry, undefined, 'only a SET latches');
		assert.deepStrictEqual(t.worktreePerspective, { path: '/wt', branchName: 'main' });
	});

	test('a refused RETRY does not clobber a later transition that already superseded it', async () => {
		// The guard this exercises lives on the revert path, which a FIRST refusal never reaches (a
		// retryable one latches, and this is the only way to reach the revert with a newer transition
		// outstanding) — so the superseding case has to be driven through a RETRY. The retry for wt-a is
		// refused; by the time its promise settles, a `setWorktreePerspective('/wt-b')` has already moved
		// the perspective, and that second rebind is ACCEPTED — so the only thing that could put the field
		// back on wt-a is the stale refusal this guard exists to stop.
		const rebindCalls: { worktreePath: string | undefined }[] = [];
		const fake = Object.create(proto) as GraphStateProvider;
		fake.worktreePerspective = { path: '/wt-a', branchName: 'main' };
		fake.repositories = undefined;
		priv(fake).host = { dispatchEvent: () => true };
		priv(fake).logger = { debug: () => {} };
		priv(fake)._servicesReady = { promise: Promise.resolve() };
		let callCount = 0;
		priv(fake)._scopeService = {
			rebind: (params: { worktreePath: string | undefined }) => {
				callCount++;
				rebindCalls.push(params);
				return Promise.resolve(
					callCount === 1
						? { refused: 'unavailable' }
						: { repoPath: params.worktreePath, previousRepoPath: '/home' },
				);
			},
		};

		(priv(fake).reconcileWorktreeRebind as (...args: unknown[]) => void).call(fake, '/wt-a', undefined, true);
		proto.setWorktreePerspective.call(fake, '/wt-b', { branchName: 'feature' });
		await flush();

		assert.deepStrictEqual(rebindCalls, [{ worktreePath: '/wt-a' }, { worktreePath: '/wt-b' }]);
		assert.deepStrictEqual(
			fake.worktreePerspective,
			{ path: '/wt-b', branchName: 'feature' },
			'the superseding transition must win, not the stale refusal',
		);
	});
});

/**
 * The latch is only half of finding 4's fix — the other half is the handoff that consumes it. These
 * drive the REAL wiring (`connectServices` → `state.onStateChanged` → retry) rather than calling
 * `reconcileWorktreeRebind` directly, so a latch that nothing ever consumed would fail here.
 */
suite('GraphStateProvider — the refused-rebind retry rides the next state push', () => {
	const proto = GraphStateProvider.prototype;

	function priv(t: GraphStateProvider): Record<string, unknown> {
		return t as unknown as Record<string, unknown>;
	}

	function flush(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 0));
	}

	/**
	 * Wires a constructor-bypassed provider against fake RPC services and hands back the state-plane
	 * handler `connectServices` registered, which is what a host state push arrives on.
	 *
	 * Every service is the same Proxy: each `onXxx(handler)` records the handler and returns a no-op
	 * unsubscribe, which is all `subscribeAll` needs (it swallows individual failures anyway).
	 */
	async function connectFakeServices(refusals: GraphRebindRefusalReason[]): Promise<{
		t: GraphStateProvider;
		rebindCalls: { worktreePath: string | undefined }[];
		pushState: (state: Partial<State>) => void;
	}> {
		const rebindCalls: { worktreePath: string | undefined }[] = [];
		const handlers = new Map<string, (data: unknown) => void>();
		const fake = Object.create(proto) as GraphStateProvider;
		fake.scope = undefined;
		fake.worktreePerspective = undefined;
		fake.pendingScopeToBranch = false;
		fake.repositories = undefined;
		fake.selectedRepository = undefined;
		priv(fake)._wips = { pin: () => {}, unpin: () => {} };
		priv(fake).options = {};
		priv(fake).fireProviderUpdate = () => {};
		priv(fake)._mergeBaseCache = new Map<string, ResolvedScopeAnchor | undefined>();
		priv(fake).host = { dispatchEvent: () => true };
		priv(fake).logger = { debug: () => {} };
		priv(fake)._servicesReady = { promise: Promise.resolve(), fulfill: () => {} };

		const methods: Record<string, unknown> = {
			rebind: (params: { worktreePath: string | undefined }) => {
				rebindCalls.push(params);
				const refused = refusals.shift();
				return Promise.resolve(
					refused != null ? { refused: refused } : { repoPath: '/wt', previousRepoPath: '/home' },
				);
			},
		};
		// `then` must answer `undefined` on BOTH proxies: `Promise.all`/`await` probe their values for a
		// `then` method, and a synthesized subscription function found there reads as a thenable that
		// never settles — the handshake would hang instead of connecting.
		const service = new Proxy(methods, {
			get: (target, prop) => {
				if (typeof prop !== 'string' || prop === 'then') return undefined;

				return (
					target[prop] ??
					((handler: (data: unknown) => void) => {
						handlers.set(prop, handler);
						return () => {};
					})
				);
			},
		});
		const services = new Proxy(
			{},
			{ get: (_target, prop) => (prop === 'then' ? undefined : Promise.resolve(service)) },
		);

		await (priv(fake).connectServices as (this: GraphStateProvider, services: unknown) => Promise<unknown>).call(
			fake,
			services,
		);

		return {
			t: fake,
			rebindCalls: rebindCalls,
			pushState: (state: Partial<State>) => handlers.get('onStateChanged')!({ state: state }),
		};
	}

	test('a latched retry re-fires on the next full-state push', async () => {
		// First attempt refused as not-ready (cold open), second accepted.
		const { t, rebindCalls, pushState } = await connectFakeServices(['not-ready']);

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'main' });
		await flush();
		assert.deepStrictEqual(rebindCalls, [{ worktreePath: '/wt' }], 'the first attempt fired and was refused');

		pushState({});
		await flush();

		assert.deepStrictEqual(
			rebindCalls,
			[{ worktreePath: '/wt' }, { worktreePath: '/wt' }],
			'the state push is the "host is alive now" signal — the retry rides it',
		);
		assert.deepStrictEqual(t.worktreePerspective, { path: '/wt', branchName: 'main' }, 'and it landed');
		assert.strictEqual(priv(t)._pendingRebindRetry, undefined, 'the latch is consumed');
	});

	test('a second push does not fire a third attempt — the latch is one-shot', async () => {
		const { t, rebindCalls, pushState } = await connectFakeServices(['not-ready', 'not-ready']);

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'main' });
		await flush();
		pushState({});
		await flush();
		pushState({});
		await flush();

		assert.strictEqual(rebindCalls.length, 2, 'a refused retry must not re-latch');
		assert.strictEqual(t.worktreePerspective, undefined, 'and the refused retry reverted the perspective');
	});

	test('a superseded latch is dropped rather than re-fired at the stale target', async () => {
		// The user moved on (cleared the scope) between the refusal and the push — retrying the old target
		// would re-scope a graph they just unscoped.
		const { t, rebindCalls, pushState } = await connectFakeServices(['not-ready']);

		proto.setWorktreePerspective.call(t, '/wt', { branchName: 'main' });
		await flush();
		proto.clearWorktreePerspective.call(t);
		await flush();

		const callsBeforePush = rebindCalls.length;
		pushState({});
		await flush();

		assert.strictEqual(rebindCalls.length, callsBeforePush, 'no retry for a target that is no longer live');
		assert.strictEqual(priv(t)._pendingRebindRetry, undefined, 'the stale latch is consumed either way');
	});
});

suite('GraphStateProvider — scope writes no longer drive the rebind side-channel', () => {
	// Pins the two-mode split: `setScope`/`clearScope` must never touch `_scopeService.rebind` — only
	// `setWorktreePerspective`/`clearWorktreePerspective` do (see the suite above).
	const proto = GraphStateProvider.prototype;

	function priv(t: GraphStateProvider): Record<string, unknown> {
		return t as unknown as Record<string, unknown>;
	}

	function createFakeThis(): { t: GraphStateProvider; rebindCalls: unknown[] } {
		const rebindCalls: unknown[] = [];
		const fake = Object.create(proto) as GraphStateProvider;
		fake.scope = undefined;
		fake.worktreePerspective = undefined;
		fake.pendingScopeToBranch = false;
		priv(fake)._mergeBaseCache = new Map<string, ResolvedScopeAnchor | undefined>();
		priv(fake).host = { dispatchEvent: () => true };
		priv(fake).logger = { debug: () => {} };
		priv(fake)._servicesReady = { promise: Promise.resolve() };
		priv(fake)._scopeService = {
			rebind: (params: unknown) => {
				rebindCalls.push(params);
				return Promise.resolve({ repoPath: '/wt', previousRepoPath: '/home' });
			},
		};
		return { t: fake, rebindCalls: rebindCalls };
	}

	// A macrotask boundary, not a fixed `.then()` hop count — matches the positive suite above. A
	// vacuous `deepStrictEqual(rebindCalls, [])` from under-flushing (the chain never getting the
	// chance to run) would pass here just as easily as a genuine "never fires" result, so this has to
	// drain every pending microtask the same way the positive assertions rely on it to.
	function flush(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 0));
	}

	test('setScope to a worktree-origin branch never fires rebind', async () => {
		const { t, rebindCalls } = createFakeThis();
		priv(t)._mergeBaseCache = new Map([['/wt|heads/feature', undefined]]);

		await proto.setScope.call(t, {
			branchRef: '/wt|heads/feature',
			branchName: 'feature',
			origin: { kind: 'worktree', path: '/wt' },
		} satisfies GraphScope);
		await flush();

		assert.deepStrictEqual(rebindCalls, []);
	});

	test('clearScope on a worktree-origin scope never fires rebind', async () => {
		const { t, rebindCalls } = createFakeThis();
		t.scope = { branchRef: '/wt|heads/feature', branchName: 'feature', origin: { kind: 'worktree', path: '/wt' } };

		proto.clearScope.call(t);
		await flush();

		assert.deepStrictEqual(rebindCalls, []);
	});

	test('a pull-request-origin scope never fires rebind either', async () => {
		const { t, rebindCalls } = createFakeThis();
		t.scope = { branchRef: '/repo|heads/pr-1', branchName: 'pr-1', origin: { kind: 'pullRequest', number: '1' } };

		proto.clearScope.call(t);
		await flush();

		assert.deepStrictEqual(rebindCalls, []);
	});

	test('focusing a different branch while perspectived leaves the perspective untouched and fires no rebind', async () => {
		const { t, rebindCalls } = createFakeThis();
		t.worktreePerspective = { path: '/wt', branchName: 'main' };
		t.scope = { branchRef: '/wt|heads/main', branchName: 'main' };
		priv(t)._mergeBaseCache = new Map([['/wt|heads/feature', undefined]]);

		await proto.setScope.call(t, { branchRef: '/wt|heads/feature', branchName: 'feature' } satisfies GraphScope);
		await flush();

		assert.deepStrictEqual(rebindCalls, []);
		assert.deepStrictEqual(
			t.worktreePerspective,
			{ path: '/wt', branchName: 'main' },
			'a focus change must not move or clear an independent perspective',
		);
	});
});

suite('GraphStateProvider updateState — same-family rebind vs cross-family switch', () => {
	const proto = GraphStateProvider.prototype;
	// `updateState` is `protected` — this bare access would be a TS2445 outside the class, so the
	// property read itself has to happen through an untyped view, not just the eventual `.call()`.
	const protoUnsafe = proto as unknown as {
		updateState: (this: GraphStateProvider, partial: Partial<State>, silent?: boolean) => void;
	};

	// Unlike `WIP stats supersession` above (a narrow, independent `FakeThis` object), `updateState`
	// calls OTHER prototype methods via `this.xxx(...)` (`restampScopeStateForRebind`, `cancelPendingScope`,
	// `clearScope`, `setScope`) — those resolve at runtime only if the fake actually inherits from
	// `GraphStateProvider.prototype`, so this fake is a real (constructor-bypassed) instance, same
	// approach as `pendingScopeToBranch cancellation` above. Field initializers (`_wips`, `options`,
	// `fireProviderUpdate`) never run under `Object.create` (no constructor call), so they're seeded
	// manually below — through `priv()`, since they (and `_pendingScope`/`_mergeBaseCache`) are private
	// and only reachable from a differently-typed view of the same object, not through `t` itself.
	function priv(t: GraphStateProvider): Record<string, unknown> {
		return t as unknown as Record<string, unknown>;
	}

	function createFakeThis(): GraphStateProvider {
		const fake = Object.create(proto) as GraphStateProvider;
		fake.scope = undefined;
		fake.worktreePerspective = undefined;
		fake.pendingScopeToBranch = false;
		fake.repositories = undefined;
		fake.selectedRepository = undefined;
		priv(fake)._wips = { pin: () => {}, unpin: () => {} };
		priv(fake).options = {};
		priv(fake).fireProviderUpdate = () => {};
		priv(fake)._mergeBaseCache = new Map<string, ResolvedScopeAnchor | undefined>();
		return fake;
	}

	function makeRepo(id: string, path: string, commonPath?: string): NonNullable<State['repositories']>[number] {
		return { id: id, name: id, path: path, commonPath: commonPath, uri: `file://${path}`, virtual: false };
	}

	const home = makeRepo('/home', '/home');
	const worktree = makeRepo('/wt', '/wt', '/home');
	const other = makeRepo('/other', '/other');

	test('same-family switch re-stamps the published scope onto the new repo path', () => {
		const t = createFakeThis();
		t.repositories = [home];
		t.selectedRepository = home.id;
		t.scope = {
			branchName: 'main',
			branchRef: '/home|heads/main',
			upstreamRef: '/home|remotes/origin/main',
			mergeBase: { sha: 'a'.repeat(40), date: 1 },
		};

		protoUnsafe.updateState.call(t, { repositories: [home, worktree], selectedRepository: worktree.id });

		assert.deepStrictEqual(t.scope, {
			branchName: 'main',
			branchRef: '/wt|heads/main',
			upstreamRef: '/wt|remotes/origin/main',
			mergeBase: { sha: 'a'.repeat(40), date: 1 },
		});
	});

	test('same-family switch re-keys the merge-base anchor cache, leaving unrelated entries alone', () => {
		const t = createFakeThis();
		t.repositories = [home];
		t.selectedRepository = home.id;
		const anchor: ResolvedScopeAnchor = {
			mergeBase: { sha: 'a'.repeat(40), date: 1 },
			mergeTargetTipSha: undefined,
			focalBranchTipSha: undefined,
		};
		priv(t)._mergeBaseCache = new Map<string, ResolvedScopeAnchor | undefined>([
			['/home|heads/main', anchor],
			// A different repo's entry the family-scoped prefix match must not touch.
			['/unrelated|heads/main', anchor],
		]);

		protoUnsafe.updateState.call(t, { repositories: [home, worktree], selectedRepository: worktree.id });

		const cache = priv(t)._mergeBaseCache as Map<string, ResolvedScopeAnchor | undefined>;
		assert.strictEqual(cache.get('/wt|heads/main'), anchor);
		assert.strictEqual(cache.has('/home|heads/main'), false);
		assert.strictEqual(cache.get('/unrelated|heads/main'), anchor);
	});

	test('same-family switch re-stamps a pending scope and republishes it synchronously on a cache hit', () => {
		const t = createFakeThis();
		t.repositories = [home];
		t.selectedRepository = home.id;
		const anchor: ResolvedScopeAnchor = {
			mergeBase: { sha: 'b'.repeat(40), date: 2 },
			mergeTargetTipSha: undefined,
			focalBranchTipSha: undefined,
		};
		// Pre-seed the cache under the NEW repoPath — as if a prior scope on the same branch had already
		// resolved anchors there, so re-driving the pending scope through `setScope` hits the cache
		// synchronously instead of awaiting an anchor IPC.
		priv(t)._mergeBaseCache = new Map<string, ResolvedScopeAnchor | undefined>([['/wt|heads/main', anchor]]);
		priv(t)._pendingScope = { branchName: 'main', branchRef: '/home|heads/main' } satisfies GraphScope;

		protoUnsafe.updateState.call(t, { repositories: [home, worktree], selectedRepository: worktree.id });

		assert.strictEqual(priv(t)._pendingScope, undefined, 'the re-driven setScope call must clear it on publish');
		assert.deepStrictEqual(t.scope, {
			branchName: 'main',
			branchRef: '/wt|heads/main',
			mergeBase: { sha: 'b'.repeat(40), date: 2 },
		});
	});

	test('cross-family switch clears the pending scope instead of re-stamping it (existing behavior)', () => {
		const t = createFakeThis();
		t.repositories = [home];
		t.selectedRepository = home.id;
		// `clearScope` cancels any pending scope unconditionally, but its telemetry emission (and the
		// `this.scope` clear itself) only fire when there's a PUBLISHED scope to clear — seed both a
		// real `scope` and a minimal `host` stub (`emitTelemetrySentEvent` only ever calls
		// `.dispatchEvent` on it) so this test actually exercises that half too, not just the pending-scope
		// cancel (which fires either way — see the dedicated test below).
		t.scope = { branchName: 'main', branchRef: '/home|heads/main' };
		priv(t).host = { dispatchEvent: () => true };
		priv(t)._pendingScope = { branchName: 'main', branchRef: '/home|heads/main' } satisfies GraphScope;
		priv(t)._mergeBaseCache = new Map<string, ResolvedScopeAnchor | undefined>([
			[
				'/home|heads/main',
				{
					mergeBase: { sha: 'a'.repeat(40), date: 1 },
					mergeTargetTipSha: undefined,
					focalBranchTipSha: undefined,
				},
			],
		]);

		protoUnsafe.updateState.call(t, { repositories: [home, other], selectedRepository: other.id });

		assert.strictEqual(priv(t)._pendingScope, undefined);
		assert.strictEqual(t.scope, undefined, 'the cross-family path must actually clear a published scope');
		// Unlike the same-family path, a cross-family switch never re-keys the anchor cache — it's a
		// different dataset, so the stale entry is simply left to age out, not moved.
		const cache = priv(t)._mergeBaseCache as Map<string, ResolvedScopeAnchor | undefined>;
		assert.strictEqual(cache.has('/home|heads/main'), true);
	});

	test('unrelated repositories/selectedRepository shapes missing from the list fall back to a full clear', () => {
		const t = createFakeThis();
		t.repositories = [home];
		t.selectedRepository = home.id;
		priv(t)._pendingScope = { branchName: 'main', branchRef: '/home|heads/main' } satisfies GraphScope;

		// The new selection isn't present in the incoming `repositories` list (a stale id mid repo-list
		// refresh) — `nextShape` resolves to `undefined`, so the safe default (full clear) applies rather
		// than risking a family compare against a shape that doesn't exist yet.
		protoUnsafe.updateState.call(t, { repositories: [home], selectedRepository: '/ghost' });

		assert.strictEqual(priv(t)._pendingScope, undefined);
	});

	test('same-family switch re-stamps the worktree perspective onto the new repo path', () => {
		const t = createFakeThis();
		t.repositories = [home];
		t.selectedRepository = home.id;
		t.worktreePerspective = { path: '/home', branchName: 'main' };

		protoUnsafe.updateState.call(t, { repositories: [home, worktree], selectedRepository: worktree.id });

		assert.deepStrictEqual(t.worktreePerspective, { path: '/wt', branchName: 'main' });
	});

	test('same-family switch leaves an unrelated perspective (a different repoPath) alone', () => {
		const t = createFakeThis();
		t.repositories = [home];
		t.selectedRepository = home.id;
		t.worktreePerspective = { path: '/elsewhere', branchName: 'main' };

		protoUnsafe.updateState.call(t, { repositories: [home, worktree], selectedRepository: worktree.id });

		assert.deepStrictEqual(t.worktreePerspective, { path: '/elsewhere', branchName: 'main' });
	});

	test('same-family switch back to HOME clears the perspective instead of re-stamping it onto home', () => {
		// The plain repo PICKER (not a worktree gesture) choosing home while a perspective is live on a
		// sibling worktree — home is the default, un-perspectived identity, so landing there must not
		// leave a stale "perspectived on home" flag tinting the bar and offering "Unscope Worktree" for a
		// binding that isn't actually scoped to anything.
		const t = createFakeThis();
		t.repositories = [worktree];
		t.selectedRepository = worktree.id;
		t.worktreePerspective = { path: '/wt', branchName: 'main' };

		protoUnsafe.updateState.call(t, { repositories: [worktree, home], selectedRepository: home.id });

		assert.strictEqual(t.worktreePerspective, undefined);
	});

	test('same-family switch between two non-home worktrees still follows the perspective', () => {
		// The picker (not a gesture) moving from one sibling worktree to another while perspectived — the
		// destination is still non-home, so the perspective stays meaningful and should track the binding,
		// unlike the home case above.
		const t = createFakeThis();
		const worktree2 = makeRepo('/wt2', '/wt2', '/home');
		t.repositories = [worktree];
		t.selectedRepository = worktree.id;
		t.worktreePerspective = { path: '/wt', branchName: 'main' };

		protoUnsafe.updateState.call(t, { repositories: [worktree, worktree2], selectedRepository: worktree2.id });

		assert.deepStrictEqual(t.worktreePerspective, { path: '/wt2', branchName: 'main' });
	});

	test('window homed ON a worktree: switching to the MAIN checkout keeps the perspective (main is an ordinary scope target)', () => {
		// Home is `homeRepositoryPath` — the worktree the window was opened on — NOT the family's main
		// checkout (see `State.homeRepositoryPath`/`isHomeWorktree`). Scoping such a window to the main
		// checkout is an ordinary worktree scope, so the rebind's own state push must not strip the
		// scoped UI (tint, ✕, sidebar marker) out from under a live, correct perspective.
		const t = createFakeThis();
		t.homeRepositoryPath = '/wt';
		t.repositories = [worktree];
		t.selectedRepository = worktree.id;
		t.worktreePerspective = { path: '/home', branchName: 'main' };

		protoUnsafe.updateState.call(t, { repositories: [worktree, home], selectedRepository: home.id });

		assert.deepStrictEqual(t.worktreePerspective, { path: '/home', branchName: 'main' });
	});

	test('window homed ON a worktree: switching back to that worktree clears the perspective (it IS home)', () => {
		// The inverse: landing on `homeRepositoryPath` — even though it's not the family's main
		// checkout — is landing on the un-scoped identity, so a live perspective must clear rather than
		// follow onto home and claim "scoped to home".
		const t = createFakeThis();
		const worktree2 = makeRepo('/wt2', '/wt2', '/home');
		t.homeRepositoryPath = '/wt';
		t.repositories = [worktree2];
		t.selectedRepository = worktree2.id;
		t.worktreePerspective = { path: '/wt2', branchName: 'main' };

		protoUnsafe.updateState.call(t, { repositories: [worktree2, worktree], selectedRepository: worktree.id });

		assert.strictEqual(t.worktreePerspective, undefined);
	});

	test('cross-family switch clears the worktree perspective WITHOUT firing the rebind RPC', () => {
		const t = createFakeThis();
		t.repositories = [home];
		t.selectedRepository = home.id;
		t.worktreePerspective = { path: '/home', branchName: 'main' };
		// Deliberately NOT stubbing `_scopeService`/`_servicesReady`: the cross-family branch must clear
		// the perspective with a direct assignment (the host already reset the binding), never through
		// `clearWorktreePerspective()` — which would touch `_scopeService.rebind` and throw here (both are
		// `undefined` on this fake), catching a regression that re-fires a redundant RPC.
		protoUnsafe.updateState.call(t, { repositories: [home, other], selectedRepository: other.id });

		assert.strictEqual(t.worktreePerspective, undefined);
	});
});
