import * as assert from 'assert';
import type { GraphWipMetadataBySha } from '../../../../plus/graph/protocol.js';
import type { GetOverviewEnrichmentResponse } from '../../../../shared/overviewBranches.js';
import type { AppState } from '../context.js';
import { mergeWipMetadata, reconcileScopeMergeTarget } from '../stateProvider.js';

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
});

function entry(label: string, parentSha: string) {
	return { repoPath: `/repos/${label}`, parentSha: parentSha, label: label };
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
