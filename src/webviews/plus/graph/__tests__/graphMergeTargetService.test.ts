import * as assert from 'assert';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GlRepository } from '../../../../git/models/repository.js';
import type { GraphMergeTargetIdentity, GraphMergeTargetServiceContext } from '../graphMergeTargetService.js';
import {
	canKeepVerdictWhileRecomputing,
	GraphMergeTargetService,
	hasMergedPullRequest,
} from '../graphMergeTargetService.js';
import type { GraphCurrentBranchMergeTarget, GraphCurrentBranchMergeTargetState } from '../protocol.js';
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

function liveUpstreamBranch(sha: string, ahead: number): GitBranch {
	return {
		repoPath: '/repo',
		name: 'feature',
		sha: sha,
		current: true,
		detached: false,
		remoteName: 'origin',
		upstream: { name: 'origin/feature', missing: false, state: { ahead: ahead, behind: 0 } },
	} as unknown as GitBranch;
}

function pullRequest(state: PullRequest['state']): PullRequest {
	return { state: state } as unknown as PullRequest;
}

suite('graph merge-target verdict — live upstream gate', () => {
	test('stays lazy while the pull request is open', async () => {
		let byNameRead = false;
		const merged = await hasMergedPullRequest(
			liveUpstreamBranch('aaa', 1),
			() => Promise.resolve(pullRequest('opened')),
			() => {
				byNameRead = true;
				return Promise.resolve([pullRequest('merged')]);
			},
		);
		assert.strictEqual(merged, false);
		assert.strictEqual(byNameRead, false);
	});

	test('computes once the pull request merged', async () => {
		const merged = await hasMergedPullRequest(
			liveUpstreamBranch('aaa', 0),
			() => Promise.resolve(pullRequest('merged')),
			() => Promise.resolve(undefined),
		);
		assert.strictEqual(merged, true);
	});

	test('computes for a merged pull request found by head name when the branch is ahead', async () => {
		const merged = await hasMergedPullRequest(
			liveUpstreamBranch('aaa', 2),
			() => Promise.resolve(undefined),
			() => Promise.resolve([pullRequest('opened'), pullRequest('merged')]),
		);
		assert.strictEqual(merged, true);
	});

	test('reads by head name only when the branch is ahead', async () => {
		let byNameRead = false;
		const merged = await hasMergedPullRequest(
			liveUpstreamBranch('aaa', 0),
			() => Promise.resolve(undefined),
			() => {
				byNameRead = true;
				return Promise.resolve([pullRequest('merged')]);
			},
		);
		assert.strictEqual(merged, false);
		assert.strictEqual(byNameRead, false);
	});

	test('drops a verdict for another identity before waiting on the pull request', async () => {
		let branch = liveUpstreamBranch('aaa', 1);
		const published: GraphCurrentBranchMergeTargetState[] = [];
		const context = {
			container: {
				git: {
					getRepositoryService: () => ({ remotes: { getRemote: () => new Promise(() => {}) } }),
				},
			},
			host: { ready: true, visible: true },
			fireCurrentBranchMergeTargetChanged: (state: GraphCurrentBranchMergeTargetState) => published.push(state),
			fireMergeTargetsChanged: () => {},
		} as unknown as GraphMergeTargetServiceContext;
		const repo = {
			path: '/repo',
			git: { branches: { getBranch: () => Promise.resolve(branch) } },
		} as unknown as GlRepository;

		const service = new GraphMergeTargetService(context);
		try {
			service.setRepository(repo);
			await new Promise(resolve => setTimeout(resolve, 0));
			assert.strictEqual(published.at(-1)?.verdict?.tipSha, 'aaa');

			branch = liveUpstreamBranch('bbb', 1);
			service.onPullRequestChanged();
			await new Promise(resolve => setTimeout(resolve, 0));

			const verdict = published.at(-1)?.verdict;
			assert.strictEqual(verdict?.tipSha, 'bbb');
			assert.strictEqual(verdict.liveUpstream, true);
			assert.strictEqual(verdict.status, undefined);
		} finally {
			service.dispose();
		}
	});
});
