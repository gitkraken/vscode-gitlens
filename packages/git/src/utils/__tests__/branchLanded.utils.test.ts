import * as assert from 'assert';
import type { PullRequestState } from '../../models/pullRequest.js';
import type { BranchLandedPullRequestCandidate } from '../branchLanded.utils.js';
import { getBranchLandedState } from '../branchLanded.utils.js';

const tip = 'aaaaaaa';
const older = 'bbbbbbb';

function candidate(
	number: number,
	state: PullRequestState,
	headSha: string | undefined,
	newCommits?: number,
): BranchLandedPullRequestCandidate {
	return {
		pullRequest: {
			id: `node-${number}`,
			url: `https://github.com/owner/repo/pull/${number}`,
			title: `PR ${number}`,
			state: state,
			refs:
				headSha != null
					? ({ head: { sha: headSha } } as unknown as BranchLandedPullRequestCandidate['pullRequest']['refs'])
					: undefined,
		},
		newCommits: newCommits,
	};
}

suite('branchLanded.utils', () => {
	suite('getBranchLandedState', () => {
		test('merged with its head at the tip is landed, by the pull request number', () => {
			assert.deepStrictEqual(getBranchLandedState(tip, [candidate(12, 'merged', tip)]), {
				landed: {
					via: 'pr',
					confidence: 'highest',
					pullRequest: { id: '12', url: 'https://github.com/owner/repo/pull/12', title: 'PR 12' },
				},
			});
		});

		test('merged with no new commits after its head is landed', () => {
			const state = getBranchLandedState(tip, [candidate(12, 'merged', older, 0)]);
			assert.strictEqual(state.landed?.pullRequest.id, '12');
			assert.strictEqual(state.successor, undefined);
		});

		test('merged with new commits after its head is a successor, not landed', () => {
			assert.deepStrictEqual(getBranchLandedState(tip, [candidate(12, 'merged', older, 3)]), {
				successor: { pullRequest: { id: '12', url: 'https://github.com/owner/repo/pull/12' }, newCommits: 3 },
			});
		});

		test('open with its head at the tip is live, so nothing landed', () => {
			assert.deepStrictEqual(getBranchLandedState(tip, [candidate(12, 'opened', tip)]), { live: true });
		});

		test('open at the tip wins over a merged pull request at the same tip', () => {
			assert.deepStrictEqual(
				getBranchLandedState(tip, [candidate(11, 'merged', tip), candidate(12, 'opened', tip)]),
				{ live: true },
			);
		});

		test('a newer open follow-up not at the tip never hides the merged one', () => {
			const state = getBranchLandedState(tip, [candidate(13, 'opened', 'ccccccc'), candidate(12, 'merged', tip)]);
			assert.strictEqual(state.landed?.pullRequest.id, '12');
		});

		test('a newer open follow-up not at the tip leaves the merged one a successor', () => {
			const state = getBranchLandedState(tip, [
				candidate(13, 'opened', 'ccccccc'),
				candidate(12, 'merged', older, 2),
			]);
			assert.deepStrictEqual(state.successor, {
				pullRequest: { id: '12', url: 'https://github.com/owner/repo/pull/12' },
				newCommits: 2,
			});
		});

		test('the head at the tip decides, not recency', () => {
			const state = getBranchLandedState(tip, [candidate(13, 'merged', older, 4), candidate(12, 'merged', tip)]);
			assert.strictEqual(state.landed?.pullRequest.id, '12');
		});

		test('of several merged pull requests, the one with the fewest new commits decides', () => {
			const state = getBranchLandedState(tip, [
				candidate(11, 'merged', 'ccccccc', 5),
				candidate(12, 'merged', older, 1),
			]);
			assert.strictEqual(state.successor?.pullRequest.id, '12');
			assert.strictEqual(state.successor?.newCommits, 1);
		});

		test('a tie keeps the first (newest) merged pull request', () => {
			const state = getBranchLandedState(tip, [
				candidate(12, 'merged', 'ccccccc', 0),
				candidate(11, 'merged', older, 0),
			]);
			assert.strictEqual(state.landed?.pullRequest.id, '12');
		});

		test('an empty or missing head sha never decides', () => {
			assert.deepStrictEqual(getBranchLandedState(tip, [candidate(12, 'merged', '', 0)]), {});
			assert.deepStrictEqual(getBranchLandedState(tip, [candidate(12, 'merged', undefined, 0)]), {});
			assert.deepStrictEqual(getBranchLandedState(tip, [candidate(12, 'opened', '')]), {});
		});

		test('a merged pull request whose new commits are unknown is undecided', () => {
			assert.deepStrictEqual(getBranchLandedState(tip, [candidate(12, 'merged', older)]), {});
		});

		test('a closed (unmerged) pull request never decides', () => {
			assert.deepStrictEqual(getBranchLandedState(tip, [candidate(12, 'closed', tip)]), {});
			assert.deepStrictEqual(getBranchLandedState(tip, [candidate(12, 'closed', older, 0)]), {});
		});

		test('no pull request, or no tip, decides nothing', () => {
			assert.deepStrictEqual(getBranchLandedState(tip, []), {});
			assert.deepStrictEqual(getBranchLandedState(undefined, [candidate(12, 'merged', tip)]), {});
		});

		test('falls back to the id when the url names no pull request number', () => {
			const state = getBranchLandedState(tip, [
				{
					...candidate(12, 'merged', tip),
					pullRequest: { ...candidate(12, 'merged', tip).pullRequest, url: 'https://example.com/x' },
				},
			]);
			assert.strictEqual(state.landed?.pullRequest.id, 'node-12');
		});
	});
});
