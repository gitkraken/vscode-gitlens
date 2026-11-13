import * as assert from 'assert';
import { getDeleteBranchOrWorktreeEvidence } from '../deleteBranchOrWorktree.utils.js';

suite('plus/shared/deleteBranchOrWorktree.utils', () => {
	suite('getDeleteBranchOrWorktreeEvidence', () => {
		test('a merged pull request passes as PR evidence, which may pre-select Force Delete', () => {
			assert.deepStrictEqual(
				getDeleteBranchOrWorktreeEvidence({
					via: 'pr',
					confidence: 'highest',
					pullRequest: { id: '12', url: 'https://github.com/o/r/pull/12' },
					tipSha: 'abc',
				}),
				{ mergedPullRequest: { id: '12', sha: 'abc' } },
			);
		});

		test('git evidence passes only as git evidence, never as a merged pull request', () => {
			for (const confidence of ['highest', 'high', 'medium'] as const) {
				assert.deepStrictEqual(
					getDeleteBranchOrWorktreeEvidence({ via: 'git', confidence: confidence, tipSha: 'abc' }),
					{ mergedByGit: { confidence: confidence, sha: 'abc' } },
				);
			}
		});

		test('a verdict without the tip it was decided for passes no evidence', () => {
			assert.strictEqual(getDeleteBranchOrWorktreeEvidence({ via: 'git', confidence: 'highest' }), undefined);
			assert.strictEqual(
				getDeleteBranchOrWorktreeEvidence({
					via: 'pr',
					confidence: 'highest',
					pullRequest: { id: '12', url: 'https://github.com/o/r/pull/12' },
				}),
				undefined,
			);
			assert.strictEqual(getDeleteBranchOrWorktreeEvidence(undefined), undefined);
		});
	});
});
