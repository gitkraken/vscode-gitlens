import { window } from 'vscode';
import type { Container } from '../../container';
import { executeCommand } from '../../system/-webview/command';
import { PausedOperationContinueError, PausedOperationContinueErrorReason } from '../errors';
import type { GitPausedOperationStatus } from '../models/pausedOperationStatus';
import { Repository } from '../models/repository';
import { getReferenceLabel } from '../utils/reference.utils';

export async function abortPausedOperation(repo: Repository, options?: { quit?: boolean }): Promise<void>;
export async function abortPausedOperation(
	container: Container,
	repoPath: string,
	options?: { quit?: boolean },
): Promise<void>;
export async function abortPausedOperation(
	repoOrContainer: Repository | Container,
	repoPathOrOptions?: string | { quit?: boolean },
	options?: { quit?: boolean },
): Promise<void> {
	try {
		if (repoOrContainer instanceof Repository) {
			return await repoOrContainer.git.status().abortPausedOperation?.(repoPathOrOptions as { quit?: boolean });
		}

		return await repoOrContainer.git.status(repoPathOrOptions as string).abortPausedOperation?.(options);
	} catch (ex) {
		void window.showErrorMessage(ex.message);
	}
}

export async function continuePausedOperation(repo: Repository): Promise<void>;

export async function continuePausedOperation(container: Container, repoPath: string): Promise<void>;

export async function continuePausedOperation(
	repoOrContainer: Repository | Container,
	repoPath?: string,
): Promise<void> {
	return continuePausedOperationCore(repoOrContainer, repoPath);
}

export async function skipPausedOperation(repo: Repository): Promise<void>;

export async function skipPausedOperation(container: Container, repoPath: string): Promise<void>;

export async function skipPausedOperation(repoOrContainer: Repository | Container, repoPath?: string): Promise<void> {
	return continuePausedOperationCore(repoOrContainer, repoPath, true);
}

async function continuePausedOperationCore(
	repoOrContainer: Repository | Container,
	repoPath?: string,
	skip: boolean = false,
): Promise<void> {
	try {
		if (repoOrContainer instanceof Repository) {
			return await repoOrContainer.git.status().continuePausedOperation?.(skip ? { skip: true } : undefined);
		}
		return await repoOrContainer.git.status(repoPath!).continuePausedOperation?.(skip ? { skip: true } : undefined);
	} catch (ex) {
		if (
			ex instanceof PausedOperationContinueError &&
			ex.reason === PausedOperationContinueErrorReason.EmptyCommit
		) {
			let operation: GitPausedOperationStatus | undefined;
			try {
				const repo =
					repoOrContainer instanceof Repository
						? repoOrContainer
						: repoOrContainer.git.getRepository(repoPath!);
				operation = await repo?.git.status().getPausedOperationStatus?.();
				operation ??= await repo
					?.waitForRepoChange(500)
					.then(() => repo?.git.status().getPausedOperationStatus?.());
			} catch {}
			operation ??= ex.operation;

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
				return void continuePausedOperationCore(repoOrContainer, repoPath, true);
			}

			void executeCommand('gitlens.showCommitsView');

			return;
		}

		void window.showErrorMessage(ex.message);
	}
}
