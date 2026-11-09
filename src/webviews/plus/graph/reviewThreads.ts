import type { Comment, CommentingRangeProvider, CommentReply, CommentThread, TextDocument, Uri } from 'vscode';
import {
	CommentMode,
	comments,
	CommentThreadCollapsibleState,
	CommentThreadState,
	l10n,
	MarkdownString,
	Range,
} from 'vscode';
import type { AIReviewSeverity } from '@gitlens/ai/models/results.js';
import { isUncommitted, isUncommittedStaged } from '@gitlens/git/utils/revision.utils.js';
import { uuid } from '@gitlens/utils/crypto.js';
import type { Container } from '../../../container.js';
import { GitUri } from '../../../git/gitUri.js';
import type {
	ReviewCommentPlace,
	ReviewFindingNote,
	ReviewThreadAction,
	ReviewThreadItem,
	ReviewThreadsArgs,
} from './graphService.js';

/** The graph instance whose findings the threads show; thread actions go back to it. */
export interface ReviewThreadsOwner {
	reviewThreadAction(
		findingId: string,
		action: ReviewThreadAction,
		text?: string,
		place?: ReviewCommentPlace,
		noteId?: string,
	): void;
	/** The review file `uri` is, when it is the right side of one of the review's diffs — where the reader
	 *  can open a thread of their own. */
	reviewCommentPath(uri: Uri): string | undefined;
	/** Another instance took the editor over — this one's threads are gone from it. */
	reviewThreadsReleased(): void;
}

const controllerId = 'gitlens.review';
let controller: ReturnType<typeof comments.createCommentController> | undefined;
let owner: ReviewThreadsOwner | undefined;
const threads = new Map<string, CommentThread>();
const threadFindings = new WeakMap<CommentThread, string>();
/** What each shown comment is — the comment commands (edit, delete) get the comment, not its thread. The
 *  first comment is the finding itself (`noteId` absent), the rest are notes on it; `text` is what an
 *  edit of the reader's own comment falls back to. */
const commentRefs = new WeakMap<Comment, { thread: CommentThread; findingId: string; noteId?: string; text: string }>();
/** The item each thread shows — what its title goes back to once a question on it is answered. */
const shownItems = new WeakMap<CommentThread, ReviewThreadItem>();
/** Findings the reviewer was asked about and hasn't answered yet, with how many comments of the agent's
 *  each had when asked: the answer is a comment of the agent's on the finding, so a newer one ends the wait. */
const asking = new Map<string, number>();
/** How many comments of the agent's each finding has, as of the last sync. */
const agentComments = new Map<string, number>();
/** The latest item for a thread with a comment open for editing: rebuilding its comments would close the
 *  edit and lose what was typed, so the item waits for the edit to end. */
const heldItems = new WeakMap<CommentThread, ReviewThreadItem>();

/** Any line of a review diff's right side takes a comment; the rest of the editor takes none. */
const commentingRangeProvider: CommentingRangeProvider = {
	provideCommentingRanges: (document: TextDocument) => {
		if (owner?.reviewCommentPath(document.uri) == null) return undefined;

		return [new Range(0, 0, Math.max(0, document.lineCount - 1), 0)];
	},
};

function getController() {
	if (controller == null) {
		controller = comments.createCommentController(controllerId, l10n.t('GitLens Review'));
		// What is typed here is not an answer to anyone — it is a note kept with the finding, for the fix
		// and the review passes that follow
		controller.options = {
			prompt: l10n.t('Leave a comment'),
			placeHolder: l10n.t(
				'A note for the fix and the later review — why it was closed, a question, a correction…',
			),
		};
		controller.commentingRangeProvider = commentingRangeProvider;
	}
	return controller;
}

/** Hands the editor's threads to `next`. The instance they were taken from is told after the hand-over, so
 *  what it lets go of on its way out is no longer its to clear. */
function takeOwnership(next: ReviewThreadsOwner): void {
	if (owner === next) return;

	const previous = owner;
	clearThreads();
	owner = next;
	previous?.reviewThreadsReleased();
}

/** Makes `next` the owner the editor's comment gutter asks — the graph whose review files are set. */
export function claimReviewCommenting(next: ReviewThreadsOwner): void {
	takeOwnership(next);
	refreshReviewCommenting();
}

/** Has the editor ask again where comments can go — the review's files or its open diffs changed. Setting
 *  the provider is what makes VS Code re-ask. */
export function refreshReviewCommenting(): void {
	if (controller == null && owner == null) return;

	getController().commentingRangeProvider = commentingRangeProvider;
}

function severityLabel(severity: AIReviewSeverity): string {
	switch (severity) {
		case 'critical':
			return l10n.t('Critical');
		case 'warning':
			return l10n.t('Warning');
		default:
			return l10n.t('Suggestion');
	}
}

/** Whether a review diff shows the working file itself on its right — an unstaged diff — rather than a
 *  revision document (a staged side included). The threads, the diff title buttons, the comment gutter and
 *  the re-anchoring of finding lines all go by this one rule, so they land on the same document. */
export function isReviewWorkingSide(rhs: string): boolean {
	return isUncommitted(rhs) && !isUncommittedStaged(rhs);
}

/** The document a review diff opens on its right for `path` — where the threads go and what the title
 *  buttons and the comment gutter match on. */
export function getReviewSideUri(container: Container, repoPath: string, rhs: string, path: string): Uri {
	if (isReviewWorkingSide(rhs)) return container.git.getRepositoryService(repoPath).getAbsoluteUri(path, repoPath);

	return container.git.getRevisionUriFromGitUri(GitUri.fromFile(path, repoPath, rhs));
}

function noteAuthor(author: ReviewFindingNote['author']): string {
	return author === 'agent' ? l10n.t('Agent') : l10n.t('You');
}

function toNoteComment(note: ReviewFindingNote): Comment {
	return {
		body: new MarkdownString(note.text),
		mode: CommentMode.Preview,
		author: { name: noteAuthor(note.author) },
		timestamp: new Date(note.at),
		contextValue: `note-${note.author}`,
	};
}

function threadLabel(item: ReviewThreadItem): string {
	if (asking.has(item.findingId)) return l10n.t('Waiting for the reviewer…');

	return item.source === 'user' ? l10n.t('Comment') : severityLabel(item.severity);
}

function relabelFindingThreads(findingId: string): void {
	for (const thread of threads.values()) {
		if (threadFindings.get(thread) !== findingId) continue;

		const item = shownItems.get(thread);
		if (item != null) {
			thread.label = threadLabel(item);
		}
	}
}

function countAgentComments(item: ReviewThreadItem): number {
	return (item.author === 'agent' ? 1 : 0) + (item.notes?.filter(n => n.author === 'agent').length ?? 0);
}

/** The reviewer was asked about `findingId`: its threads say so until the answer shows in them, or until
 *  {@link stopAskingReviewer} — the hand-off didn't go through, or the channel the answer would come by closed. */
export function markReviewerAsked(from: ReviewThreadsOwner, findingId: string): void {
	if (owner !== from) return;

	asking.set(findingId, agentComments.get(findingId) ?? 0);
	relabelFindingThreads(findingId);
}

/** No answer is coming on `findingId` — or on any finding, without one. */
export function stopAskingReviewer(from: ReviewThreadsOwner, findingId?: string): void {
	if (owner !== from) return;

	for (const id of findingId != null ? [findingId] : [...asking.keys()]) {
		if (asking.delete(id)) {
			relabelFindingThreads(id);
		}
	}
}

function applyItem(thread: CommentThread, item: ReviewThreadItem): void {
	shownItems.set(thread, item);
	const isUser = item.source === 'user';
	let first: Comment;
	if (isUser) {
		// A comment of the review's own: the words as written, no severity or title over them — the reader's,
		// or the agent's when its reply took over a thread whose opening was deleted
		first = {
			body: new MarkdownString(item.description),
			mode: CommentMode.Preview,
			author: { name: item.author === 'agent' ? l10n.t('Agent') : l10n.t('You') },
			contextValue: item.author === 'agent' ? 'agent-comment' : 'user-comment',
		};
	} else {
		first = {
			body: new MarkdownString(`**${severityLabel(item.severity)}** · ${item.title}\n\n${item.description}`),
			mode: CommentMode.Preview,
			author: {
				name: item.source === 'agent' ? l10n.t('Agent') : l10n.t('GitLens AI Review'),
			},
			contextValue: item.state,
		};
	}
	commentRefs.set(first, { thread: thread, findingId: item.findingId, text: item.description });
	const notes = (item.notes ?? []).map(note => {
		const comment = toNoteComment(note);
		if (note.id != null) {
			commentRefs.set(comment, { thread: thread, findingId: item.findingId, noteId: note.id, text: note.text });
		}
		return comment;
	});
	thread.comments = [first, ...notes];
	thread.label = threadLabel(item);
	thread.contextValue = item.state;
	thread.state = item.state === 'open' ? CommentThreadState.Unresolved : CommentThreadState.Resolved;
	thread.collapsibleState =
		item.state === 'open' ? CommentThreadCollapsibleState.Expanded : CommentThreadCollapsibleState.Collapsed;
	// A closed finding can still take a word on why — that goes to the session, the exports and the
	// next review the same as a reply on an open one
	thread.canReply = true;
}

function isEditing(thread: CommentThread): boolean {
	return thread.comments.some(c => c.mode === CommentMode.Editing);
}

/** Shows `item` in its thread, or holds it while a comment there is being edited. The title still follows —
 *  setting it leaves the comments alone. */
function showItem(thread: CommentThread, item: ReviewThreadItem): void {
	if (isEditing(thread)) {
		heldItems.set(thread, item);
		thread.label = threadLabel(item);
		return;
	}

	heldItems.delete(thread);
	applyItem(thread, item);
}

/** The edit ended: what the review sent meanwhile shows now — unless another comment there is still open. */
function showHeldItem(thread: CommentThread): void {
	const item = heldItems.get(thread);
	if (item == null || isEditing(thread)) return;

	heldItems.delete(thread);
	applyItem(thread, item);
}

/** Replaces the shown threads with `args.items` — one thread per finding that has a line, updated in
 *  place where it already exists so an open thread doesn't blink. `undefined` removes them all. */
export function setReviewThreads(
	container: Container,
	next: ReviewThreadsOwner,
	args: ReviewThreadsArgs | undefined,
): void {
	takeOwnership(next);
	if (args == null || args.items.length === 0) {
		clearThreads();
		return;
	}

	agentComments.clear();
	for (const item of args.items) {
		agentComments.set(item.findingId, countAgentComments(item));
	}
	// The answer is in once the agent has a newer comment on the finding. A finding missing from this sync
	// keeps waiting: the sync may be one from before the question, and without threads nothing shows it
	for (const [findingId, asked] of asking) {
		if ((agentComments.get(findingId) ?? 0) > asked) {
			asking.delete(findingId);
		}
	}

	const keep = new Set<string>();
	for (const item of args.items) {
		keep.add(item.id);
		const uri = getReviewSideUri(container, args.repoPath, args.rhs, item.path);
		const range = new Range(Math.max(0, item.line - 1), 0, Math.max(0, item.lineEnd - 1), 0);
		let thread = threads.get(item.id);
		if (thread != null && thread.uri.toString() !== uri.toString()) {
			thread.dispose();
			thread = undefined;
		}
		if (thread == null) {
			thread = getController().createCommentThread(uri, range, []);
			threads.set(item.id, thread);
			threadFindings.set(thread, item.findingId);
		} else if (!thread.range?.isEqual(range)) {
			thread.range = range;
		}
		showItem(thread, item);
	}
	for (const [id, thread] of threads) {
		if (keep.has(id)) continue;

		thread.dispose();
		threads.delete(id);
	}
}

/** Drops the threads if `from` still owns them — a disposing instance must not clear another's. */
export function releaseReviewThreads(from: ReviewThreadsOwner): void {
	if (owner !== from) return;

	clearThreads();
	owner = undefined;
	refreshReviewCommenting();
}

/** What a thread's title-bar command does: hand the finding back to the graph that owns it. */
export function runReviewThreadAction(thread: CommentThread | undefined, action: ReviewThreadAction): void {
	const findingId = thread != null ? threadFindings.get(thread) : undefined;
	if (findingId == null) return;

	owner?.reviewThreadAction(findingId, action);
}

/** The thread's reply box: the text becomes a note on the finding. It shows in the thread at once — the
 *  session's copy replaces it on the next sync with the same words — so the reply doesn't vanish while
 *  the round trip through the panel runs. */
export function runReviewThreadReply(
	reply: CommentReply | undefined,
	action: 'reply' | 'askReviewer' | 'address' = 'reply',
): void {
	if (reply == null) return;

	const text = reply.text.trim();
	const findingId = threadFindings.get(reply.thread);
	if (findingId == null) {
		// A thread the reader opened on a line: the words are a comment of theirs, which the reviewer or the
		// fixer can then be asked to take up
		const id = text ? adoptReaderThread(reply.thread, text) : undefined;
		if (id != null && action !== 'reply') {
			owner?.reviewThreadAction(id, action);
		}
		return;
	}
	// A bare reply needs words; asking the reviewer or the fixer to take the thread up does not
	if (!text && action === 'reply') return;

	if (text) {
		reply.thread.comments = [
			...reply.thread.comments,
			toNoteComment({ author: 'user', text: text, at: Date.now() }),
		];
	}
	owner?.reviewThreadAction(findingId, action, text || undefined);
}

/** Drops a thread the reader opened on a line but hasn't written in yet — what they typed goes with it. A
 *  thread already in the review is left alone. */
export function discardReviewThread(reply: CommentReply | undefined): void {
	if (reply == null || threadFindings.has(reply.thread)) return;

	reply.thread.dispose();
}

/** Takes a thread the editor made from the gutter into the review: it becomes the new comment's thread,
 *  shown at once with the words in it, and the comment goes to the graph. */
function adoptReaderThread(thread: CommentThread, text: string): string | undefined {
	const path = owner?.reviewCommentPath(thread.uri);
	if (owner == null || path == null || thread.range == null) return undefined;

	const id = `user-${uuid()}`;
	const place: ReviewCommentPlace = {
		path: path,
		line: thread.range.start.line + 1,
		lineEnd: thread.range.end.line + 1,
	};
	threads.set(id, thread);
	threadFindings.set(thread, id);
	applyItem(thread, {
		id: id,
		findingId: id,
		path: place.path,
		line: place.line,
		lineEnd: place.lineEnd,
		severity: 'suggestion',
		title: '',
		description: text,
		state: 'open',
		source: 'user',
	});
	owner.reviewThreadAction(id, 'comment', text, place);
	return id;
}

function setUserCommentMode(comment: Comment, mode: CommentMode, text?: string): void {
	const found = commentRefs.get(comment);
	if (found == null) return;

	comment.mode = mode;
	if (text != null) {
		comment.body = new MarkdownString(text);
	}
	found.thread.comments = [...found.thread.comments];
}

/** The reader's comment opens for editing in place. */
export function editReviewComment(comment: Comment | undefined): void {
	if (comment == null) return;

	setUserCommentMode(comment, CommentMode.Editing);
}

/** Puts the comment back as it was. */
export function cancelReviewCommentEdit(comment: Comment | undefined): void {
	const found = comment != null ? commentRefs.get(comment) : undefined;
	if (comment == null || found == null) return;

	setUserCommentMode(comment, CommentMode.Preview, found.text);
	showHeldItem(found.thread);
}

/** The edited words go to the graph; the thread shows them at once. Emptied out, the comment stays as it was. */
export function saveReviewComment(comment: Comment | undefined): void {
	const found = comment != null ? commentRefs.get(comment) : undefined;
	if (comment == null || found == null) return;

	const text = (typeof comment.body === 'string' ? comment.body : comment.body.value).trim();
	if (!text || text === found.text) {
		setUserCommentMode(comment, CommentMode.Preview, found.text);
		showHeldItem(found.thread);
		return;
	}

	found.text = text;
	setUserCommentMode(comment, CommentMode.Preview, text);
	// What the review sent while the edit was open predates it: the edit goes into it, so the thread doesn't
	// show the old words until the review's copy of the new ones comes back
	const held = heldItems.get(found.thread);
	if (held != null) {
		heldItems.set(
			found.thread,
			found.noteId == null
				? { ...held, description: text }
				: { ...held, notes: held.notes?.map(n => (n.id === found.noteId ? { ...n, text: text } : n)) },
		);
	}
	showHeldItem(found.thread);
	if (found.noteId != null) {
		owner?.reviewThreadAction(found.findingId, 'editNote', text, undefined, found.noteId);
	} else {
		owner?.reviewThreadAction(found.findingId, 'editComment', text);
	}
}

/** Removes a comment from its thread. A reply goes by itself. The first comment is the finding's opening:
 *  with replies after it, the first of them opens the thread from then on; alone, it takes the thread — and
 *  the finding's threads elsewhere — with it. The editor changes at once, the review follows. A reply still
 *  on its way to the review has nothing to be removed by yet and stays. */
export function deleteReviewComment(comment: Comment | undefined): void {
	const found = comment != null ? commentRefs.get(comment) : undefined;
	if (comment == null || found == null) return;

	if (found.noteId == null && found.thread.comments.length <= 1) {
		deleteFindingThreads(found.findingId);
		return;
	}

	found.thread.comments = found.thread.comments.filter(c => c !== comment);
	if (found.noteId == null) {
		owner?.reviewThreadAction(found.findingId, 'deleteOpening');
	} else {
		owner?.reviewThreadAction(found.findingId, 'deleteNote', undefined, undefined, found.noteId);
	}
}

/** Removes the thread's finding — every thread it has, with all their comments. */
export function deleteReviewThread(thread: CommentThread | undefined): void {
	const findingId = thread != null ? threadFindings.get(thread) : undefined;
	if (findingId == null) return;

	deleteFindingThreads(findingId);
}

function deleteFindingThreads(findingId: string): void {
	for (const [id, thread] of threads) {
		if (threadFindings.get(thread) !== findingId) continue;

		thread.dispose();
		threads.delete(id);
	}
	owner?.reviewThreadAction(findingId, 'delete');
}

function clearThreads(): void {
	for (const thread of threads.values()) {
		thread.dispose();
	}
	threads.clear();
	asking.clear();
	agentComments.clear();
}

export function disposeReviewThreads(): void {
	clearThreads();
	owner = undefined;
	controller?.dispose();
	controller = undefined;
}
