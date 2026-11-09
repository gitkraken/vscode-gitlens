import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Comment, CommentController, CommentThread, Range } from 'vscode';
import { CommentMode, comments, MarkdownString, Uri } from 'vscode';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { Container } from '../../../../container.js';
import type { ReviewFindingNote, ReviewThreadItem, ReviewThreadsArgs } from '../graphService.js';
import type { ReviewThreadsOwner } from '../reviewThreads.js';
import {
	cancelReviewCommentEdit,
	disposeReviewThreads,
	editReviewComment,
	getReviewSideUri,
	isReviewWorkingSide,
	markReviewerAsked,
	releaseReviewThreads,
	saveReviewComment,
	setReviewThreads,
	stopAskingReviewer,
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

/** Threads on the working side of an unstaged diff — no revision documents to resolve. */
const threadsContainer = {
	git: {
		getRepositoryService: () => ({
			getAbsoluteUri: (path: string, repoPath: string) => Uri.file(`${repoPath}/${path}`),
		}),
	},
} as unknown as Container;

function threadItem(id: string, findingId: string, notes?: ReviewFindingNote[]): ReviewThreadItem {
	return {
		id: id,
		findingId: findingId,
		path: `${id}.ts`,
		line: 1,
		lineEnd: 1,
		severity: 'warning',
		title: 'A title',
		description: 'A description',
		state: 'open',
		notes: notes,
	};
}

function threadsArgs(items: ReviewThreadItem[]): ReviewThreadsArgs {
	return { anchor: 'wip', repoPath: '/repo', rhs: uncommitted, items: items };
}

/** A comment controller whose threads are plain objects, by the thread id their file is named after. */
function fakeCommentController(): Map<string, CommentThread> {
	const shown = new Map<string, CommentThread>();
	const controller = {
		createCommentThread: (uri: Uri, range: Range, threadComments: Comment[]) => {
			const id = uri.path.slice(uri.path.lastIndexOf('/') + 1, -'.ts'.length);
			const thread = {
				uri: uri,
				range: range,
				comments: threadComments,
				dispose: () => shown.delete(id),
			} as unknown as CommentThread;
			shown.set(id, thread);
			return thread;
		},
		dispose: () => {},
	} as unknown as CommentController;
	sinon.stub(comments, 'createCommentController').returns(controller);
	return shown;
}

const waiting = 'Waiting for the reviewer…';
const agentNote: ReviewFindingNote = { id: 'n1', author: 'agent', text: 'It is fine', at: 1 };

suite('reviewThreads — a question to the reviewer', () => {
	let shown: Map<string, CommentThread>;
	let owner: ReviewThreadsOwner;

	setup(() => {
		shown = fakeCommentController();
		owner = createThreadsOwner();
		setReviewThreads(
			threadsContainer,
			owner,
			threadsArgs([threadItem('a1', 'a'), threadItem('a2', 'a'), threadItem('b1', 'b')]),
		);
	});

	teardown(() => {
		disposeReviewThreads();
		sinon.restore();
	});

	test('titles every thread of the finding as waiting, and only those', () => {
		markReviewerAsked(owner, 'a');

		assert.strictEqual(shown.get('a1')?.label, waiting);
		assert.strictEqual(shown.get('a2')?.label, waiting, 'a finding in several places waits in each');
		assert.strictEqual(shown.get('b1')?.label, 'Warning');
	});

	test('keeps waiting through a sync that brings no answer', () => {
		markReviewerAsked(owner, 'a');
		const question: ReviewFindingNote = { id: 'q', author: 'user', text: 'Why?', at: 1 };
		setReviewThreads(
			threadsContainer,
			owner,
			threadsArgs([threadItem('a1', 'a', [question]), threadItem('b1', 'b')]),
		);

		assert.strictEqual(shown.get('a1')?.label, waiting, "the reader's own words are not the answer");
	});

	test('stops waiting once the agent comments on the finding', () => {
		markReviewerAsked(owner, 'a');
		setReviewThreads(
			threadsContainer,
			owner,
			threadsArgs([threadItem('a1', 'a', [agentNote]), threadItem('b1', 'b')]),
		);

		assert.strictEqual(shown.get('a1')?.label, 'Warning');
	});

	test('waits for a newer answer than the one the finding already had', () => {
		setReviewThreads(threadsContainer, owner, threadsArgs([threadItem('a1', 'a', [agentNote])]));
		markReviewerAsked(owner, 'a');
		setReviewThreads(threadsContainer, owner, threadsArgs([threadItem('a1', 'a', [agentNote])]));
		assert.strictEqual(shown.get('a1')?.label, waiting);

		const answer: ReviewFindingNote = { id: 'n2', author: 'agent', text: 'Still fine', at: 2 };
		setReviewThreads(threadsContainer, owner, threadsArgs([threadItem('a1', 'a', [agentNote, answer])]));
		assert.strictEqual(shown.get('a1')?.label, 'Warning');
	});

	test('stops waiting when the hand-off fails or the channel closes', () => {
		markReviewerAsked(owner, 'a');
		markReviewerAsked(owner, 'b');

		stopAskingReviewer(owner, 'a');
		assert.strictEqual(shown.get('a1')?.label, 'Warning', 'the failed question');
		assert.strictEqual(shown.get('b1')?.label, waiting, 'another question still waits');

		stopAskingReviewer(owner);
		assert.strictEqual(shown.get('b1')?.label, 'Warning', 'a closed channel answers none');
	});

	test('is not taken from a graph that no longer shows the threads', () => {
		const other = createThreadsOwner();
		markReviewerAsked(other, 'a');
		assert.strictEqual(shown.get('a1')?.label, 'Warning');

		markReviewerAsked(owner, 'a');
		stopAskingReviewer(other);
		assert.strictEqual(shown.get('a1')?.label, waiting, "another graph's channel closing is not this one's");
	});
});

suite('reviewThreads — a comment being edited', () => {
	let shown: Map<string, CommentThread>;
	let owner: ReviewThreadsOwner & { reviewThreadAction: sinon.SinonStub };

	const userNote: ReviewFindingNote = { id: 'n1', author: 'user', text: 'My note', at: 1 };
	const later: ReviewFindingNote = { id: 'n2', author: 'agent', text: 'An answer', at: 2 };

	/** The reader's own comment `u` with a note of theirs, and an AI finding `b`. */
	function readerItems(uNotes: ReviewFindingNote[], bNotes?: ReviewFindingNote[]): ReviewThreadsArgs {
		return threadsArgs([
			{ ...threadItem('u1', 'u', uNotes), source: 'user', description: 'My words' },
			threadItem('b1', 'b', bNotes),
		]);
	}

	const bodyOf = (comment: Comment | undefined) =>
		typeof comment?.body === 'string' ? comment.body : comment?.body.value;

	setup(() => {
		shown = fakeCommentController();
		owner = { ...createThreadsOwner(), reviewThreadAction: sinon.stub() };
		setReviewThreads(threadsContainer, owner, readerItems([userNote]));
	});

	teardown(() => {
		disposeReviewThreads();
		sinon.restore();
	});

	test('keeps its thread through a sync, while the other threads follow', () => {
		const thread = shown.get('u1')!;
		const editing = thread.comments[1];
		editReviewComment(editing);
		const before = thread.comments;

		setReviewThreads(threadsContainer, owner, readerItems([userNote, later], [later]));

		assert.strictEqual(thread.comments, before, 'the comments are not rebuilt');
		assert.strictEqual(editing.mode, CommentMode.Editing);
		assert.strictEqual(shown.get('b1')?.comments.length, 2, 'another thread takes the sync');
	});

	test('shows what the review sent meanwhile once the edit is cancelled', () => {
		const thread = shown.get('u1')!;
		const editing = thread.comments[1];
		editReviewComment(editing);
		setReviewThreads(threadsContainer, owner, readerItems([userNote, later]));

		cancelReviewCommentEdit(editing);

		assert.deepStrictEqual(
			thread.comments.map(c => [bodyOf(c), c.mode]),
			[
				['My words', CommentMode.Preview],
				['My note', CommentMode.Preview],
				['An answer', CommentMode.Preview],
			],
		);
	});

	test('shows the saved words with what the review sent meanwhile', () => {
		const thread = shown.get('u1')!;
		const editing = thread.comments[1];
		editReviewComment(editing);
		setReviewThreads(threadsContainer, owner, readerItems([userNote, later]));

		editing.body = new MarkdownString('My note, edited');
		saveReviewComment(editing);

		assert.deepStrictEqual(
			thread.comments.map(c => bodyOf(c)),
			['My words', 'My note, edited', 'An answer'],
			"the review's copy from before the save doesn't bring the old words back",
		);
		assert.deepStrictEqual(owner.reviewThreadAction.lastCall.args, [
			'u',
			'editNote',
			'My note, edited',
			undefined,
			'n1',
		]);
	});

	test('waits for every comment open in the thread', () => {
		const thread = shown.get('u1')!;
		const [opening, note] = thread.comments;
		editReviewComment(opening);
		editReviewComment(note);
		setReviewThreads(threadsContainer, owner, readerItems([userNote, later]));

		opening.body = new MarkdownString('My words, edited');
		saveReviewComment(opening);
		assert.strictEqual(thread.comments.length, 2, 'the note is still open');
		assert.strictEqual(note.mode, CommentMode.Editing);

		cancelReviewCommentEdit(note);
		assert.deepStrictEqual(
			thread.comments.map(c => bodyOf(c)),
			['My words, edited', 'My note', 'An answer'],
		);
	});
});
