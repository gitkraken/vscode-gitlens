import { window } from 'vscode';
import { PausedOperationAbortError, PausedOperationContinueError } from '@gitlens/git/errors.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { getReferenceLabel } from '@gitlens/git/utils/reference.utils.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { showGitErrorMessage } from '../../messages.js';
import { arePlusFeaturesEnabled } from '../../plus/gk/utils/-webview/plus.utils.js';
import { executeCommand } from '../../system/-webview/command.js';
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

export async function continuePausedOperation(container: Container, svc: GitRepositoryService): Promise<void> {
	return continuePausedOperationCore(container, svc);
}

export async function skipPausedOperation(container: Container, svc: GitRepositoryService): Promise<void> {
	return continuePausedOperationCore(container, svc, true);
}

async function continuePausedOperationCore(
	container: Container,
	svc: GitRepositoryService,
	skip: boolean = false,
): Promise<void> {
	try {
		return await svc.pausedOps?.continuePausedOperation?.(skip ? { skip: true } : undefined);
	} catch (ex) {
		if (PausedOperationContinueError.is(ex, 'emptyCommit')) {
			// Use the operation status from the error - it's already accurate
			// The previous code tried to wait for a repo change, but that would fire on the
			// change event from the failed continue (not the skip), resulting in stale data
			const operation: GitPausedOperationStatus = ex.details.operation;

			const pausedAt = getReferenceLabel(operation.incoming, { icon: false, label: true, quoted: true });

			const skipItem = { title: 'Skip' };
			const cancelItem = { title: 'Cancel', isCloseAffordance: true };

			// TODO@eamodio: We should offer a continue with allowing an empty commit option

			const result = await window.showInformationMessage(
				`The ${operation.type} operation cannot be continued because ${pausedAt} resulted in an empty commit.\n\nDo you want to skip ${pausedAt}?`,
				{ modal: true },
				skipItem,
				cancelItem,
			);
			if (result === skipItem) {
				return void continuePausedOperationCore(container, svc, true);
			}

			void showPausedOperationStatus(container, svc.path);

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
			void window.showWarningMessage(ex.message);
			void showPausedOperationStatus(container, svc.path);
			return;
		}

		void showGitErrorMessage(ex);
	}
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

	return (await container.git.access('graph', repoPath)).allowed !== false;
}

function revealPausedOperationInGraph(repoPath: string, source?: Source): void {
	void executeCommand('gitlens.showGraph', {
		action: 'show-wip',
		target: { sha: uncommitted, worktreePath: repoPath },
		source: source,
	});
}
