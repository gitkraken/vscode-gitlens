import { EventEmitter, Uri, window } from 'vscode';
import { PausedOperationAbortError, PausedOperationContinueError } from '@gitlens/git/errors.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { pausedOperationStatusStringsByType } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { getReferenceLabel } from '@gitlens/git/utils/reference.utils.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { showGitErrorMessage } from '../../messages.js';
import { arePlusFeaturesEnabled } from '../../plus/gk/utils/-webview/plus.utils.js';
import { isAccountAccessRequired } from '../../plus/gk/utils/subscription.utils.js';
import { executeCommand } from '../../system/-webview/command.js';
import { isDescendant } from '../../system/-webview/path.js';
import type { GitRepositoryService } from '../gitRepositoryService.js';
import { openRebaseEditor } from '../utils/-webview/rebase.utils.js';

export async function abortPausedOperation(svc: GitRepositoryService, options?: { quit?: boolean }): Promise<void> {
	try {
		return await svc.pausedOps?.abortPausedOperation?.(options);
	} catch (ex) {
		// Ignore this as it can happen when the operation was already aborted (e.g., by clearing the rebase todo file before calling this)
		if (PausedOperationAbortError.is(ex, 'nothingToAbort')) return;

		void showGitErrorMessage(ex);
	}
}

/** Repos with a continue/skip in flight, keyed by {@link getRepositoryKey} — callers pass repo
 *  paths in different forms, and a raw `Uri.fsPath` differs from the normalized form on Windows.
 *  `<op> --continue` can block indefinitely — git opens `COMMIT_EDITMSG` and waits for the tab to
 *  be closed — and the git runner dedups the still-running command by args, so a second invocation
 *  would silently ride the first and appear to do nothing. */
const continuingRepos = new Set<string>();

const _onDidChangeContinuing = new EventEmitter<string>();
/** Fires with the repo path (in {@link getRepositoryKey} form) whenever a continue/skip starts or settles. */
export const onDidChangeContinuingPausedOperation = _onDidChangeContinuing.event;

/** Whether a continue/skip is still running for `repoPath` — the paused-op bar's busy state.
 *  Accepts any path form; the lookup normalizes via {@link getRepositoryKey}. */
export function isContinuingPausedOperation(repoPath: string): boolean {
	return continuingRepos.has(getRepositoryKey(repoPath));
}

export async function continuePausedOperation(
	container: Container,
	svc: GitRepositoryService,
	source?: Source,
): Promise<void> {
	return runContinue(container, svc, undefined, source);
}

export async function skipPausedOperation(
	container: Container,
	svc: GitRepositoryService,
	source?: Source,
): Promise<void> {
	return runContinue(container, svc, { skip: true }, source);
}

/** Guards the user-initiated entry points so a repeat click reports the wait instead of vanishing into
 *  the runner's dedup. The inner retries (`allowEmpty`/`skip` after the empty-commit prompt) run under
 *  the same flag — they're the same continue, still in flight. */
async function runContinue(
	container: Container,
	svc: GitRepositoryService,
	options?: { skip?: boolean },
	source?: Source,
): Promise<void> {
	const key = getRepositoryKey(svc.path);
	if (continuingRepos.has(key)) {
		void showAlreadyContinuing(svc);
		return;
	}

	continuingRepos.add(key);
	_onDidChangeContinuing.fire(key);
	try {
		// Acting on a rebase through GitLens adopts it, so later pauses of an externally-started
		// rebase auto-open under `openOnPausedRebase: 'auto'`. Rebase-only — an adopted entry is
		// cleaned up by rebase change events, which other paused operations never produce.
		const status = await svc.pausedOps?.getPausedOperationStatus?.();
		if (status?.type === 'rebase') {
			container.operationOrigins.markAdopted(svc.path);
		}

		await continuePausedOperationCore(container, svc, options, source);
	} finally {
		continuingRepos.delete(key);
		_onDidChangeContinuing.fire(key);
	}
}

/** The open commit-message document git is blocked on — `<gitdir>/COMMIT_EDITMSG` for this repo. */
function findCommitMessageUri(repoPath: string): Uri | undefined {
	for (const group of window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input: unknown = tab.input;
			if (input == null || typeof input !== 'object' || !('uri' in input)) continue;

			const { uri } = input;
			if (!(uri instanceof Uri) || !uri.path.endsWith('COMMIT_EDITMSG')) continue;
			if (isDescendant(uri, repoPath)) return uri;
		}
	}

	return undefined;
}

async function showAlreadyContinuing(svc: GitRepositoryService): Promise<void> {
	const status = await svc.pausedOps?.getPausedOperationStatus?.();
	const name = (status != null ? pausedOperationStatusStringsByType[status.type].prose : 'operation').toLowerCase();

	if (findCommitMessageUri(svc.path) == null) {
		void window.showInformationMessage(`The ${name} is already continuing — waiting for it to finish.`);
		return;
	}

	const showItem = { title: 'Show Commit Message' };
	const result = await window.showInformationMessage(
		`The ${name} is waiting for you to save and close the commit message before it can finish.`,
		showItem,
	);
	if (result !== showItem) return;

	// Re-find it: the user may have closed it while the notification was up, which unblocks git anyway.
	const uri = findCommitMessageUri(svc.path);
	if (uri != null) {
		void window.showTextDocument(uri, { preview: false });
	}
}

async function continuePausedOperationCore(
	container: Container,
	svc: GitRepositoryService,
	options?: { allowEmpty?: boolean; skip?: boolean },
	source?: Source,
): Promise<void> {
	try {
		return await svc.pausedOps?.continuePausedOperation?.(options);
	} catch (ex) {
		if (PausedOperationContinueError.is(ex, 'emptyCommit')) {
			// Use the operation status from the error - it's already accurate
			// The previous code tried to wait for a repo change, but that would fire on the
			// change event from the failed continue (not the skip), resulting in stale data
			const operation: GitPausedOperationStatus = ex.details.operation;

			const pausedAt = getReferenceLabel(operation.incoming, { icon: false, label: true, quoted: true });

			const emptyCommitItem = { title: 'Continue with Empty Commit' };
			const skipItem = { title: 'Skip' };
			const cancelItem = { title: 'Cancel', isCloseAffordance: true };

			const result = await window.showInformationMessage(
				`The ${operation.type} operation cannot be continued because ${pausedAt} resulted in an empty commit.\n\nDo you want to record ${pausedAt} as an empty commit, or skip it?`,
				{ modal: true },
				emptyCommitItem,
				skipItem,
				cancelItem,
			);
			if (result === emptyCommitItem) {
				return void continuePausedOperationCore(container, svc, { allowEmpty: true }, source);
			}
			if (result === skipItem) {
				return void continuePausedOperationCore(container, svc, { skip: true }, source);
			}

			void showPausedOperationStatus(container, svc.path, { source: source });

			return;
		}

		if (
			PausedOperationContinueError.is(ex, 'uncommittedChanges') ||
			PausedOperationContinueError.is(ex, 'unstagedChanges') ||
			PausedOperationContinueError.is(ex, 'wouldOverwriteChanges')
		) {
			void window.showWarningMessage(ex.message);
			return;
		}

		if (PausedOperationContinueError.is(ex, 'conflicts') || PausedOperationContinueError.is(ex, 'unmergedFiles')) {
			// `<op> --continue`/`--skip` drives the WHOLE operation, so a LATER step's conflict exits the
			// command non-zero even though this step did exactly what was asked — and git reports it with the
			// same "CONFLICT"/"could not apply" text as a refusal, so the reason can't tell them apart. Ask
			// the repo instead: warn only when nothing actually moved, otherwise the operation advanced and
			// simply stopped again further along, which the paused-op surface already shows.
			if (!(await hasPausedOperationProgressed(svc, ex.details.operation))) {
				void window.showWarningMessage(ex.message);
			}
			void showPausedOperationStatus(container, svc.path, { source: source });
			return;
		}

		void showGitErrorMessage(ex);
	}
}

/**
 * Whether the paused operation moved since `before` was captured — it finished, changed kind, or
 * advanced onto a different commit. Compares state rather than error text, which varies by git
 * version and locale.
 */
async function hasPausedOperationProgressed(
	svc: GitRepositoryService,
	before: GitPausedOperationStatus,
): Promise<boolean> {
	// Force a fresh read: the failing command just mutated the repo, so a cached status is exactly
	// the pre-command one we're comparing against
	const after = await svc.pausedOps?.getPausedOperationStatus?.({ force: true });
	if (after == null || after.type !== before.type) return true;

	if (after.type === 'rebase' && before.type === 'rebase') {
		// The apply backend can't report step numbers, so fall back to the commit being applied
		return (
			after.steps.current.number !== before.steps.current.number ||
			after.steps.current.commit?.ref !== before.steps.current.commit?.ref
		);
	}

	return after.HEAD.ref !== before.HEAD.ref;
}

export interface ShowPausedOperationStatusOptions {
	/** When set, the request comes from inside the rebase editor, so always surface the graph */
	fromRebaseEditor?: boolean;
	source?: Source;
}

/**
 * Surfaces a paused operation (merge/rebase/cherry-pick/revert) in a single, consistent place:
 * the Graph's WIP details (which renders the paused-op/conflict banner), except for a paused
 * rebase when the graph is gated — then the rebase editor, since it's the only usable surface.
 */
export async function showPausedOperationStatus(
	container: Container,
	repoPath: string,
	options?: ShowPausedOperationStatusOptions,
): Promise<void> {
	const svc = container.git.getRepositoryService(repoPath);
	// Force a fresh read: a caller may invoke this right after mutating paused-op state (e.g. a
	// wizard conflict) before the `'pausedOp'` FS-watcher event lands, so a cached `undefined`
	// must not make us silently surface nothing. The readdir-based detection is cheap to repeat.
	const status = await svc.pausedOps?.getPausedOperationStatus?.({ force: true });
	if (status == null) return;

	const toGraph =
		options?.fromRebaseEditor || status.type !== 'rebase' || (await isGraphAccessible(container, repoPath));
	if (toGraph) {
		revealPausedOperationInGraph(repoPath, options?.source);
		return;
	}

	await openRebaseEditor(container, repoPath);
}

async function isGraphAccessible(container: Container, repoPath: string): Promise<boolean> {
	if (!arePlusFeaturesEnabled()) return false;

	// Signed out or unverified, the Graph replaces its whole content with the account screen, so it can't
	// surface a conflict at all — regardless of plan or repo visibility. Keep the rebase editor instead.
	if (isAccountAccessRequired(await container.subscription.getSubscription())) return false;

	return (await container.git.access('graph', repoPath)).allowed !== false;
}

function revealPausedOperationInGraph(repoPath: string, source?: Source): void {
	void executeCommand('gitlens.showGraph', {
		action: 'show-wip',
		target: { sha: uncommitted, worktreePath: repoPath },
		source: source,
	});
}
