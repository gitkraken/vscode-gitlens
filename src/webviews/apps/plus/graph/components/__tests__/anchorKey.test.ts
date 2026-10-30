import * as assert from 'assert';
import { createWipRowId } from '@gitkraken/commit-graph/wip/identity.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { anchorKey } from '../anchorKey.js';

// The host tells reviews apart by this key alone — a deep review's channel is reused only for the same one
suite('anchorKey — which review a selection is', () => {
	test('the working tree under either of the shas a selection of it carries, per repository', () => {
		const wip = anchorKey({ sha: uncommitted, repoPath: '/r' });
		assert.strictEqual(anchorKey({ sha: createWipRowId('/r'), repoPath: '/r' }), wip);
		assert.notStrictEqual(anchorKey({ sha: uncommitted, repoPath: '/w' }), wip);
		assert.notStrictEqual(anchorKey({ sha: 'c1', repoPath: '/r' }), wip);
	});

	test('a commit, and the same commits in any order', () => {
		assert.notStrictEqual(anchorKey({ sha: 'c1', repoPath: '/r' }), anchorKey({ sha: 'c2', repoPath: '/r' }));

		const range = anchorKey({ shas: ['c1', 'c2'], repoPath: '/r' });
		assert.strictEqual(anchorKey({ shas: ['c2', 'c1'], repoPath: '/r' }), range);
		assert.notStrictEqual(anchorKey({ shas: ['c1', 'c2', 'c3'], repoPath: '/r' }), range);
		assert.notStrictEqual(anchorKey({ sha: 'c1', repoPath: '/r' }), range);
	});
});
