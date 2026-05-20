import * as assert from 'assert';
import type { emptySetMarker } from '@gitkraken/gitkraken-components';
import type {
	GraphIncludeOnlyRef,
	GraphIncludeOnlyRefs,
	GraphScope,
	GraphWipMetadataBySha,
} from '../../../../plus/graph/protocol.js';
import type { GetOverviewEnrichmentResponse } from '../../../../shared/overviewBranches.js';
import type { AppState } from '../context.js';
import { mergeWipMetadata, reconcileScopeMergeTarget } from '../stateProvider.js';
import {
	filterSecondariesForIncludeOnlyRefs,
	filterSecondariesForScope,
	shouldShowPrimaryWipRow,
} from '../utils/wip.utils.js';

suite('mergeWipMetadata', () => {
	test('returns undefined when incoming is undefined', () => {
		const result = mergeWipMetadata({ 'worktree-wip::/a': entry('a', 'sha1') }, undefined);
		assert.strictEqual(result, undefined);
	});

	test('returns incoming when prev is undefined', () => {
		const incoming: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1') };
		const result = mergeWipMetadata(undefined, incoming);
		assert.strictEqual(result, incoming);
	});

	test('preserves prev reference when all entries are equivalent', () => {
		const prev: GraphWipMetadataBySha = {
			'worktree-wip::/a': { ...entry('a', 'sha1'), workDirStats: { added: 1, deleted: 0, modified: 2 } },
			'worktree-wip::/b': { ...entry('b', 'sha2'), workDirStats: { added: 0, deleted: 3, modified: 0 } },
		};
		const incoming: GraphWipMetadataBySha = {
			'worktree-wip::/a': entry('a', 'sha1'),
			'worktree-wip::/b': entry('b', 'sha2'),
		};

		const result = mergeWipMetadata(prev, incoming);

		assert.strictEqual(result, prev, 'expected reference-preservation when anchor fields match');
	});

	test('produces a new object when an anchor field changes', () => {
		const prev: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1') };
		const incoming: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha2') };

		const result = mergeWipMetadata(prev, incoming);

		assert.notStrictEqual(result, prev);
		assert.strictEqual(result?.['worktree-wip::/a']?.parentSha, 'sha2');
	});

	test('produces a new object when a sha is added', () => {
		const prev: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1') };
		const incoming: GraphWipMetadataBySha = {
			'worktree-wip::/a': entry('a', 'sha1'),
			'worktree-wip::/b': entry('b', 'sha2'),
		};

		const result = mergeWipMetadata(prev, incoming);

		assert.notStrictEqual(result, prev);
		assert.ok(result?.['worktree-wip::/b']);
	});

	test('produces a new object when a sha is removed', () => {
		const prev: GraphWipMetadataBySha = {
			'worktree-wip::/a': entry('a', 'sha1'),
			'worktree-wip::/b': entry('b', 'sha2'),
		};
		const incoming: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1') };

		const result = mergeWipMetadata(prev, incoming);

		assert.notStrictEqual(result, prev);
		assert.strictEqual(Object.keys(result ?? {}).length, 1);
	});

	test('preserves prev workDirStats for matching shas while applying incoming anchors', () => {
		const prev: GraphWipMetadataBySha = {
			'worktree-wip::/a': {
				...entry('a', 'sha1'),
				workDirStats: { added: 7, deleted: 3, modified: 1 },
				workDirStatsStale: false,
			},
		};
		// An anchor field changes (parentSha), so result must be a fresh object,
		// but workDirStats from prev must survive the merge.
		const incoming: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha99') };

		const result = mergeWipMetadata(prev, incoming);

		assert.notStrictEqual(result, prev);
		const merged = result?.['worktree-wip::/a'];
		assert.strictEqual(merged?.parentSha, 'sha99');
		assert.deepStrictEqual(merged?.workDirStats, { added: 7, deleted: 3, modified: 1 });
		assert.strictEqual(merged?.workDirStatsStale, false);
	});

	test('produces a new object when branchRef changes (branch rename without sha change)', () => {
		const prev: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', '/repo|heads/old') };
		const incoming: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', '/repo|heads/new') };

		const result = mergeWipMetadata(prev, incoming);

		assert.notStrictEqual(result, prev);
		assert.strictEqual(result?.['worktree-wip::/a']?.branchRef, '/repo|heads/new');
	});

	test('preserves prev reference when branchRef matches (and other anchors match)', () => {
		const prev: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', '/repo|heads/feature') };
		const incoming: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', '/repo|heads/feature') };

		const result = mergeWipMetadata(prev, incoming);

		assert.strictEqual(result, prev);
	});

	// Regression: removing the last secondary worktree must clear `wipMetadataBySha` on the
	// webview side. The host returns `{}` (not `undefined`) when no secondaries exist so JSON
	// survives the field; this test pins the merge behavior so a future "optimize empties to
	// undefined" change can't silently reintroduce phantom anchors.
	test('returns a new empty object when incoming is empty and prev has entries', () => {
		const prev: GraphWipMetadataBySha = {
			'worktree-wip::/a': entry('a', 'sha1'),
			'worktree-wip::/b': entry('b', 'sha2'),
		};
		const result = mergeWipMetadata(prev, {});

		assert.notStrictEqual(result, prev);
		assert.deepStrictEqual(result, {});
	});
});

function entry(label: string, parentSha: string, branchRef?: string) {
	return { repoPath: `/repos/${label}`, parentSha: parentSha, label: label, branchRef: branchRef };
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

	test('backfills mergeTargetTipSha when enrichment has a sha for the scoped branch', () => {
		const result = reconcileScopeMergeTarget(scopeWithoutSha, makeEnrichment(branchRef, 'abc123'));
		assert.notStrictEqual(result, scopeWithoutSha);
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

suite('filterSecondariesForScope', () => {
	const branchRef = '/repo|heads/feature';
	const upstreamRef = '/repo|remotes/origin/feature';
	const otherRef = '/repo|heads/other';

	test('returns input unchanged when scope is undefined', () => {
		const meta: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', branchRef) };
		const result = filterSecondariesForScope(meta, undefined);
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when metadata is undefined', () => {
		const result = filterSecondariesForScope(undefined, { branchRef: branchRef, branchName: 'feature' });
		assert.strictEqual(result, undefined);
	});

	test('keeps entries whose branchRef matches scope.branchRef', () => {
		const meta: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', branchRef) };
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.strictEqual(result, meta, 'no entries dropped → same reference');
	});

	test('drops worktrees on sibling local branches even when the scope has an upstream', () => {
		// Production worktree branchRefs are always `heads/*` (git only attaches worktrees to local
		// branches), so a worktree on a different local branch that tracks the same upstream as the
		// scope is treated as a sibling, not part of the scope. The `remotes/*` `upstreamRef` is
		// deliberately not part of the match set — see `filterSecondariesForScope`.
		const meta: GraphWipMetadataBySha = {
			'worktree-wip::/scoped': entry('scoped', 'sha1', branchRef),
			'worktree-wip::/sibling': entry('sibling', 'sha2', '/repo|heads/feature-mirror'),
		};
		const result = filterSecondariesForScope(meta, {
			branchRef: branchRef,
			branchName: 'feature',
			upstreamRef: upstreamRef,
		});
		assert.ok(result?.['worktree-wip::/scoped']);
		assert.strictEqual(result?.['worktree-wip::/sibling'], undefined);
	});

	test('drops entries whose branchRef is unrelated to the scope', () => {
		const meta: GraphWipMetadataBySha = {
			'worktree-wip::/a': entry('a', 'sha1', branchRef),
			'worktree-wip::/b': entry('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.notStrictEqual(result, meta);
		assert.ok(result?.['worktree-wip::/a']);
		assert.strictEqual(result?.['worktree-wip::/b'], undefined);
	});

	test('drops sha-colliding worktree on unrelated branch (the reproduction case)', () => {
		// Both worktrees have parentSha === scope.branchRef tip sha, but only one is actually on
		// the scoped branch — the other coincidentally shares a HEAD sha. Without branchRef-aware
		// filtering, the graph component's SHA filter would let both through.
		const meta: GraphWipMetadataBySha = {
			'worktree-wip::/scoped': entry('scoped', 'sha-tip', branchRef),
			'worktree-wip::/coincident': entry('coincident', 'sha-tip', otherRef),
		};
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.ok(result?.['worktree-wip::/scoped']);
		assert.strictEqual(result?.['worktree-wip::/coincident'], undefined);
	});

	test('keeps detached worktrees (branchRef undefined) — defers to SHA filter', () => {
		const meta: GraphWipMetadataBySha = { 'worktree-wip::/detached': entry('detached', 'sha1') };
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.strictEqual(result, meta, 'detached entry passes through unchanged');
	});

	test('does not match entries with undefined branchRef when scope upstream is missing', () => {
		// Regression guard: building the scope-ref set must not insert `undefined`. If it did,
		// detached entries would match the bogus undefined slot. They should pass via the
		// branchRef == null fall-through instead.
		const meta: GraphWipMetadataBySha = {
			'worktree-wip::/detached': entry('detached', 'sha1'),
			'worktree-wip::/unrelated': entry('unrelated', 'sha2', otherRef),
		};
		const result = filterSecondariesForScope(meta, { branchRef: branchRef, branchName: 'feature' });
		assert.ok(result?.['worktree-wip::/detached'], 'detached kept');
		assert.strictEqual(result?.['worktree-wip::/unrelated'], undefined, 'unrelated dropped');
	});

	test('honors scope.additionalBranchRefs (stacked-branches forward-compat)', () => {
		const stackedRef = '/repo|heads/stacked';
		const meta: GraphWipMetadataBySha = { 'worktree-wip::/stacked': entry('stacked', 'sha1', stackedRef) };
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
		const meta: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', branchRef) };
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'all', refsFor(branchRef));
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when branchesVisibility is undefined', () => {
		const meta: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', branchRef) };
		const result = filterSecondariesForIncludeOnlyRefs(meta, undefined, refsFor(branchRef));
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when includeOnlyRefs is undefined', () => {
		const meta: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', branchRef) };
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', undefined);
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when includeOnlyRefs is empty {} (no-filter sentinel)', () => {
		// Detached-HEAD smart/current modes send `{ refs: {} }` from the host. The graph
		// component treats empty `{}` as "no filter" — we must match that here so we don't
		// silently drop every secondary WIP.
		const meta: GraphWipMetadataBySha = {
			'worktree-wip::/a': entry('a', 'sha1', branchRef),
			'worktree-wip::/b': entry('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'smart', {});
		assert.strictEqual(result, meta);
	});

	test('returns input unchanged when metadata is undefined', () => {
		const result = filterSecondariesForIncludeOnlyRefs(undefined, 'agents', refsFor(branchRef));
		assert.strictEqual(result, undefined);
	});

	test('keeps entries whose branchRef is in the include set', () => {
		const meta: GraphWipMetadataBySha = { 'worktree-wip::/a': entry('a', 'sha1', branchRef) };
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', refsFor(branchRef));
		assert.strictEqual(result, meta, 'no entries dropped → same reference');
	});

	test('drops entries whose branchRef is not in the include set', () => {
		const meta: GraphWipMetadataBySha = {
			'worktree-wip::/a': entry('a', 'sha1', branchRef),
			'worktree-wip::/b': entry('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', refsFor(branchRef));
		assert.notStrictEqual(result, meta);
		assert.ok(result?.['worktree-wip::/a']);
		assert.strictEqual(result?.['worktree-wip::/b'], undefined);
	});

	test('drops all real-branch entries when only the empty-set marker is present', () => {
		const meta: GraphWipMetadataBySha = {
			'worktree-wip::/a': entry('a', 'sha1', branchRef),
			'worktree-wip::/b': entry('b', 'sha2', otherRef),
		};
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', {
			['gk.empty-set-marker' satisfies typeof emptySetMarker]: {} as unknown as GraphIncludeOnlyRef,
		});
		assert.deepStrictEqual(result, {}, 'every real-branch entry dropped');
	});

	test('keeps detached worktrees (branchRef undefined) — defers to SHA filter', () => {
		const meta: GraphWipMetadataBySha = { 'worktree-wip::/detached': entry('detached', 'sha1') };
		const result = filterSecondariesForIncludeOnlyRefs(meta, 'agents', refsFor(branchRef));
		assert.strictEqual(result, meta, 'detached entry passes through unchanged');
	});
});

suite('shouldShowPrimaryWipRow', () => {
	const currentBranchId = '/repo|heads/feature';

	test("returns true when branchesVisibility is 'all'", () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', refsFor('/repo|heads/other'), currentBranchId, undefined),
			true,
		);
	});

	test('returns true when branchesVisibility is undefined', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow(undefined, refsFor('/repo|heads/other'), currentBranchId, undefined),
			true,
		);
	});

	test('returns true when includeOnlyRefs is undefined', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('agents', undefined, currentBranchId, undefined), true);
	});

	test('returns true when includeOnlyRefs is empty {} (no-filter sentinel)', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('smart', {}, currentBranchId, undefined), true);
	});

	test('returns true when currentBranchId is in the include set', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('agents', refsFor(currentBranchId), currentBranchId, undefined),
			true,
		);
	});

	test('returns false when currentBranchId is not in the include set (agents mode w/ no agent on current)', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('agents', refsFor('/repo|heads/other'), currentBranchId, undefined),
			false,
		);
	});

	test('returns false when only the empty-set marker is present', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow(
				'agents',
				{ ['gk.empty-set-marker' satisfies typeof emptySetMarker]: {} as unknown as GraphIncludeOnlyRef },
				currentBranchId,
				undefined,
			),
			false,
		);
	});

	test('returns true when currentBranchId is unknown (detached HEAD fallback)', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('agents', refsFor('/repo|heads/other'), undefined, undefined), true);
	});

	test("returns false when scope's focal branch isn't HEAD (descendant scope leak repro)", () => {
		// Pin with branchesVisibility === 'all' so a regression in guard ordering re-introduces
		// the leak Eric reported (primary WIP appearing under a descendant branch's scope).
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', undefined, currentBranchId, scopeFor('/repo|heads/descendant')),
			false,
		);
	});

	test('returns true when scope is undefined (no scope active)', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('all', undefined, currentBranchId, undefined), true);
	});

	test('returns true when scope.branchRef equals currentBranchId', () => {
		assert.strictEqual(shouldShowPrimaryWipRow('all', undefined, currentBranchId, scopeFor(currentBranchId)), true);
	});

	test('returns false when scope is active and HEAD is detached', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('all', undefined, undefined, scopeFor('/repo|heads/anything')),
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
				currentBranchId,
				scopeFor('/repo|heads/focal', { additionalBranchRefs: [currentBranchId] }),
			),
			false,
		);
	});

	test('scope guard precedes branchesVisibility — agents mode with off-scope focal still hides', () => {
		assert.strictEqual(
			shouldShowPrimaryWipRow('agents', refsFor(currentBranchId), currentBranchId, scopeFor('/repo|heads/other')),
			false,
		);
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
