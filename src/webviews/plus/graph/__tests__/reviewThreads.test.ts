import * as assert from 'assert';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { Container } from '../../../../container.js';
import type { ReviewThreadsOwner } from '../reviewThreads.js';
import {
	disposeReviewThreads,
	getReviewSideUri,
	isReviewWorkingSide,
	releaseReviewThreads,
	setReviewThreads,
} from '../reviewThreads.js';

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

function createThreadsOwner(): ReviewThreadsOwner & { reviewThreadsReleased: sinon.SinonStub } {
	return {
		reviewThreadAction: sinon.stub(),
		reviewCommentPath: () => undefined,
		reviewThreadsReleased: sinon.stub(),
	};
}

suite('reviewThreads — one graph shows its threads in the editor', () => {
	// No items, so no comment controller is made
	const container = {} as unknown as Container;

	teardown(() => disposeReviewThreads());

	test('tells the instance the threads were taken from, once', () => {
		const first = createThreadsOwner();
		const second = createThreadsOwner();

		setReviewThreads(container, first, undefined);
		setReviewThreads(container, first, undefined);
		assert.strictEqual(first.reviewThreadsReleased.callCount, 0, 'setting again is not a hand-over');

		setReviewThreads(container, second, undefined);
		assert.strictEqual(first.reviewThreadsReleased.callCount, 1);
		assert.strictEqual(second.reviewThreadsReleased.callCount, 0);
	});

	test('a release by an instance the threads were taken from leaves the new owner in place', () => {
		const first = createThreadsOwner();
		const second = createThreadsOwner();
		// What a released graph does on its way out
		first.reviewThreadsReleased.callsFake(() => releaseReviewThreads(first));

		setReviewThreads(container, first, undefined);
		setReviewThreads(container, second, undefined);
		releaseReviewThreads(first);

		setReviewThreads(container, first, undefined);
		assert.strictEqual(second.reviewThreadsReleased.callCount, 1, 'the second still had the threads to lose');
	});
});
