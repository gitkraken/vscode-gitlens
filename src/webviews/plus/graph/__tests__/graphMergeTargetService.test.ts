import * as assert from 'assert';
import type { GraphMergeTargetIdentity } from '../graphMergeTargetService.js';
import { canKeepVerdictWhileRecomputing } from '../graphMergeTargetService.js';
import type { GraphCurrentBranchMergeTarget } from '../protocol.js';
import { isCurrentBranchMergeTargetFor } from '../protocol.js';

const identity: GraphMergeTargetIdentity = { repoPath: '/repo', branch: 'feature', tipSha: 'aaa', generation: 1 };

function verdict(overrides?: Partial<GraphCurrentBranchMergeTarget>): GraphCurrentBranchMergeTarget {
	return { ...identity, targetRef: 'origin/main', status: undefined, ...overrides };
}

suite('graph merge-target verdict — identity', () => {
	test('is trusted only for the repo, branch and tip it was computed for', () => {
		const v = verdict();
		assert.strictEqual(isCurrentBranchMergeTargetFor(v, { repoPath: '/repo', name: 'feature', sha: 'aaa' }), true);
		assert.strictEqual(isCurrentBranchMergeTargetFor(v, { repoPath: '/repo', name: 'feature', sha: 'bbb' }), false);
		assert.strictEqual(isCurrentBranchMergeTargetFor(v, { repoPath: '/repo', name: 'other', sha: 'aaa' }), false);
		assert.strictEqual(isCurrentBranchMergeTargetFor(v, { repoPath: '/wt', name: 'feature', sha: 'aaa' }), false);
	});

	test('is never trusted for a branch whose tip is unknown', () => {
		assert.strictEqual(isCurrentBranchMergeTargetFor(verdict(), { repoPath: '/repo', name: 'feature' }), false);
	});
});

suite('graph merge-target verdict — continuity while recomputing', () => {
	test('keeps the verdict when only the target tip or pull request evidence moved', () => {
		assert.strictEqual(
			canKeepVerdictWhileRecomputing(verdict(), 'origin/feature', identity, 'origin/feature'),
			true,
		);
	});

	test('drops it when the tip moved', () => {
		assert.strictEqual(
			canKeepVerdictWhileRecomputing(
				verdict(),
				'origin/feature',
				{ ...identity, tipSha: 'bbb' },
				'origin/feature',
			),
			false,
		);
	});

	test('drops it when the merge target changed (a generation bump)', () => {
		assert.strictEqual(
			canKeepVerdictWhileRecomputing(
				verdict(),
				'origin/feature',
				{ ...identity, generation: 2 },
				'origin/feature',
			),
			false,
		);
	});

	test('drops it when the upstream changed or went missing', () => {
		assert.strictEqual(
			canKeepVerdictWhileRecomputing(verdict(), 'origin/feature', identity, 'origin/feature:gone'),
			false,
		);
	});

	test('drops it on a branch switch or rebind', () => {
		assert.strictEqual(
			canKeepVerdictWhileRecomputing(
				verdict(),
				'origin/feature',
				{ ...identity, branch: 'other' },
				'origin/feature',
			),
			false,
		);
		assert.strictEqual(
			canKeepVerdictWhileRecomputing(
				verdict(),
				'origin/feature',
				{ ...identity, repoPath: '/wt' },
				'origin/feature',
			),
			false,
		);
	});

	test('has nothing to keep while pending or before any verdict', () => {
		assert.strictEqual(
			canKeepVerdictWhileRecomputing(
				verdict({ pending: true }),
				'origin/feature:gone',
				identity,
				'origin/feature:gone',
			),
			false,
		);
		assert.strictEqual(canKeepVerdictWhileRecomputing(undefined, undefined, identity, 'origin/feature'), false);
	});
});
