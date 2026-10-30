import * as assert from 'assert';
import { Uri } from 'vscode';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { Container } from '../../../../container.js';
import { getReviewSideUri, isReviewWorkingSide } from '../reviewThreads.js';

suite('reviewThreads — the right side of a review diff', () => {
	test('is the working file only for an unstaged diff', () => {
		assert.strictEqual(isReviewWorkingSide(uncommitted), true);
		assert.strictEqual(isReviewWorkingSide(uncommittedStaged), false, 'the staged side is a revision document');
		assert.strictEqual(isReviewWorkingSide('1234567890abcdef1234567890abcdef12345678'), false);
	});

	test('opens an unstaged diff on the working file itself', () => {
		const container = {
			git: {
				getRepositoryService: () => ({
					getAbsoluteUri: (path: string, repoPath: string) => Uri.file(`${repoPath}/${path}`),
				}),
				getRevisionUriFromGitUri: () => assert.fail('an unstaged diff has no revision document'),
			},
		} as unknown as Container;

		const uri = getReviewSideUri(container, '/repo', uncommitted, 'src/a.ts');

		assert.strictEqual(uri.toString(), Uri.file('/repo/src/a.ts').toString());
	});
});
