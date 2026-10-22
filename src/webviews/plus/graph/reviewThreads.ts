import type { Comment, CommentReply, CommentThread, Uri } from 'vscode';
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
import type { Container } from '../../../container.js';
import { GitUri } from '../../../git/gitUri.js';
import type { ReviewFindingNote, ReviewThreadAction, ReviewThreadItem, ReviewThreadsArgs } from './graphService.js';

/** The graph instance whose findings the threads show; thread actions go back to it. */
export interface ReviewThreadsOwner {
	reviewThreadAction(findingId: string, action: ReviewThreadAction, text?: string): void;
}

const controllerId = 'gitlens.review';
let controller: ReturnType<typeof comments.createCommentController> | undefined;
let owner: ReviewThreadsOwner | undefined;
const threads = new Map<string, CommentThread>();
const threadFindings = new WeakMap<CommentThread, string>();

function getController() {
	controller ??= comments.createCommentController(controllerId, l10n.t('GitLens Review'));
	return controller;
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

function getThreadUri(container: Container, repoPath: string, rhs: string, path: string): Uri {
	const svc = container.git.getRepositoryService(repoPath);
	// The working file is what an unstaged diff shows on the right; anything else is a revision document
	if (isUncommitted(rhs) && !isUncommittedStaged(rhs)) return svc.getAbsoluteUri(path, repoPath);

	return container.git.getRevisionUriFromGitUri(GitUri.fromFile(path, repoPath, rhs));
}

function noteAuthor(author: ReviewFindingNote['author']): string {
	return author === 'agent' ? l10n.t('Review in Repo (agent)') : l10n.t('You');
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

function applyItem(thread: CommentThread, item: ReviewThreadItem): void {
	const body = new MarkdownString(`**${severityLabel(item.severity)}** · ${item.title}\n\n${item.description}`);
	thread.comments = [
		{
			body: body,
			mode: CommentMode.Preview,
			author: { name: item.source === 'agent' ? l10n.t('Review in Repo (agent)') : l10n.t('GitLens AI Review') },
			contextValue: item.state,
		},
		...(item.notes ?? []).map(toNoteComment),
	];
	thread.label = severityLabel(item.severity);
	thread.contextValue = item.state;
	thread.state = item.state === 'open' ? CommentThreadState.Unresolved : CommentThreadState.Resolved;
	thread.collapsibleState =
		item.state === 'open' ? CommentThreadCollapsibleState.Expanded : CommentThreadCollapsibleState.Collapsed;
	// A closed finding can still take a word on why — that goes to the session, the exports and the
	// next review the same as a reply on an open one
	thread.canReply = true;
}

/** Replaces the shown threads with `args.items` — one thread per finding that has a line, updated in
 *  place where it already exists so an open thread doesn't blink. `undefined` removes them all. */
export function setReviewThreads(
	container: Container,
	next: ReviewThreadsOwner,
	args: ReviewThreadsArgs | undefined,
): void {
	if (owner !== next) {
		clearThreads();
		owner = next;
	}
	if (args == null || args.items.length === 0) {
		clearThreads();
		return;
	}

	const keep = new Set<string>();
	for (const item of args.items) {
		keep.add(item.id);
		const uri = getThreadUri(container, args.repoPath, args.rhs, item.path);
		const range = new Range(Math.max(0, item.line - 1), 0, Math.max(0, item.lineEnd - 1), 0);
		let thread = threads.get(item.id);
		if (thread != null && thread.uri.toString() !== uri.toString()) {
			thread.dispose();
			thread = undefined;
		}
		if (thread == null) {
			thread = getController().createCommentThread(uri, range, []);
			threads.set(item.id, thread);
			threadFindings.set(thread, item.id);
		} else if (!thread.range?.isEqual(range)) {
			thread.range = range;
		}
		applyItem(thread, item);
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
export function runReviewThreadReply(reply: CommentReply | undefined): void {
	if (reply == null) return;

	const text = reply.text.trim();
	const findingId = threadFindings.get(reply.thread);
	if (findingId == null || !text) return;

	reply.thread.comments = [...reply.thread.comments, toNoteComment({ author: 'user', text: text, at: Date.now() })];
	owner?.reviewThreadAction(findingId, 'reply', text);
}

function clearThreads(): void {
	for (const thread of threads.values()) {
		thread.dispose();
	}
	threads.clear();
}

export function disposeReviewThreads(): void {
	clearThreads();
	owner = undefined;
	controller?.dispose();
	controller = undefined;
}
