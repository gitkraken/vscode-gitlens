import { window } from 'vscode';
import type { Container } from '../../container.js';
import { showGitErrorMessage } from '../../messages.js';
import { executeCommand } from '../../system/-webview/command.js';
import { PausedOperationAbortError, PausedOperationContinueError } from '../errors.js';
import type { GitRepositoryService } from '../gitRepositoryService.js';
import type { GitPausedOperationStatus } from '../models/pausedOperationStatus.js';
import { openRebaseEditor } from '../utils/-webview/rebase.utils.js';
import { getReferenceLabel } from '../utils/reference.utils.js';

export async function abortPausedOperation(svc: GitRepositoryService, options?: { quit?: boolean }): Promise<void> {
	try {
		return await svc.pausedOps?.abortPausedOperation?.(options);
	} catch (ex) {
		// Ignore this as it can happen when the operation was already aborted (e.g., by clearing the rebase todo file before calling this)
		if (PausedOperationAbortError.is(ex, 'nothingToAbort')) return;

		void showGitErrorMessage(ex);
	}
}

export async function continuePausedOperation(svc: GitRepositoryService): Promise<void> {
	return continuePausedOperationCore(svc);
}

export async function skipPausedOperation(svc: GitRepositoryService): Promise<void> {
	return continuePausedOperationCore(svc, true);
}

async function continuePausedOperationCore(svc: GitRepositoryService, skip: boolean = false): Promise<void> {
	try {
		return await svc.pausedOps?.continuePausedOperation?.(skip ? { skip: true } : undefined);
	} catch (ex) {
		if (PausedOperationContinueError.is(ex, 'emptyCommit')) {
			// Use the operation status from the error - it's already accurate
			// The previous code tried to wait for a repo change, but that would fire on the
			// change event from the failed continue (not the skip), resulting in stale data
			const operation: GitPausedOperationStatus = ex.details.operation;

			const pausedAt = getReferenceLabel(operation.incoming, { icon: false, label: true, quoted: true });

			const skip = { title: 'Skip' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };

			// TODO@eamodio: We should offer a continue with allowing an empty commit option

			const result = await window.showInformationMessage(
				`The ${operation.type} operation cannot be continued because ${pausedAt} resulted in an empty commit.\n\nDo you want to skip ${pausedAt}?`,
				{ modal: true },
				skip,
				cancel,
			);
			if (result === skip) {
				return void continuePausedOperationCore(svc, true);
			}

			void executeCommand('gitlens.showCommitsView');

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
			void executeCommand('gitlens.showCommitsView');
			return;
		}

		void showGitErrorMessage(ex);
	}
}

export interface ShowPausedOperationStatusOptions {
	openRebaseEditor?: boolean;
}

export async function showPausedOperationStatus(
	container: Container,
	repoPath: string,
	options?: ShowPausedOperationStatusOptions,
): Promise<void> {
	await container.views.commits.show({ preserveFocus: false });
	await container.views.commits.revealPausedOperationStatus(repoPath, { focus: true, expand: true, select: true });

	if (options?.openRebaseEditor) {
		await openRebaseEditor(container, repoPath);
	}
}
