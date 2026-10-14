import type { CommentThread, Uri } from 'vscode';
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
import type { ReviewThreadAction, ReviewThreadItem, ReviewThreadsArgs } from './graphService.js';

/** The graph instance whose findings the threads show; thread actions go back to it. */
export interface ReviewThreadsOwner {
	reviewThreadAction(findingId: string, action: ReviewThreadAction): void;
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

function applyItem(thread: CommentThread, item: ReviewThreadItem): void {
	const body = new MarkdownString(`**${severityLabel(item.severity)}** · ${item.title}\n\n${item.description}`);
	thread.comments = [
		{
			body: body,
			mode: CommentMode.Preview,
			author: { name: l10n.t('GitLens AI Review') },
			contextValue: item.state,
		},
	];
	thread.label = severityLabel(item.severity);
	thread.contextValue = item.state;
	thread.state = item.state === 'open' ? CommentThreadState.Unresolved : CommentThreadState.Resolved;
	thread.collapsibleState =
		item.state === 'open' ? CommentThreadCollapsibleState.Expanded : CommentThreadCollapsibleState.Collapsed;
	thread.canReply = false;
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
