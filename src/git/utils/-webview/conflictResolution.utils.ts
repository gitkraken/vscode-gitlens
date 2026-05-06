import { window } from 'vscode';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import { classifyConflictAction } from '@gitlens/git/utils/conflictResolution.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { Container } from '../../../container.js';
import { showGitErrorMessage } from '../../../messages.js';

/**
 * Resolve a single conflicted file by taking either the current (HEAD/ours) or incoming
 * (theirs) side, then stage it. Operation-agnostic — works for any paused operation type
 * (rebase, merge, cherry-pick, revert).
 */
export async function stageConflictResolution(
	container: Container,
	file: { path: string; repoPath: string; status: GitFileConflictStatus },
	resolution: 'current' | 'incoming',
): Promise<void> {
	const normalizedPath = normalizePath(file.path);
	const svc = container.git.getRepositoryService(file.repoPath);

	const conflictFiles = await svc.status.getConflictingFiles();
	const conflictFile = conflictFiles.find(f => f.path === normalizedPath);
	if (conflictFile == null) {
		Logger.warn(`stageConflictResolution: file is no longer conflicted: ${normalizedPath}`);
		return;
	}

	try {
		const action = classifyConflictAction(conflictFile.conflictStatus, resolution);
		switch (action) {
			case 'delete':
				// `git rm -f` removes the working-tree file and stages the deletion atomically,
				// so a locked/permission-denied file fails loudly instead of silently leaving
				// conflict markers staged via a follow-up `git add -A`.
				await svc.staging?.removeFile(normalizedPath, { force: true });
				return;
			case 'take-ours':
				await svc.ops?.checkoutConflictedPath?.(normalizedPath, 'ours');
				break;
			case 'take-theirs':
				await svc.ops?.checkoutConflictedPath?.(normalizedPath, 'theirs');
				break;
			case 'unsupported':
				throw new Error(`Cannot take ${resolution} side for conflict status ${conflictFile.conflictStatus}`);
		}

		await svc.staging?.stageFile(normalizedPath);
	} catch (ex) {
		void showGitErrorMessage(ex);
	}
}

/**
 * Resolve every conflicted file at once by staging the requested side. Prompts for
 * confirmation, partitions files by `classifyConflictAction`, and reports failures. Scoped
 * to paused rebases for now — bulk resolution during merge/cherry-pick/revert can follow
 * once telemetry confirms safe usage.
 */
export async function resolveAllConflicts(
	container: Container,
	repoPath: string,
	resolution: 'current' | 'incoming',
): Promise<void> {
	const svc = container.git.getRepositoryService(repoPath);
	const pausedStatus = await svc.pausedOps?.getPausedOperationStatus?.();
	if (pausedStatus?.type !== 'rebase') {
		Logger.warn('resolveAllConflicts: unable to resolve — paused rebase status unavailable');
		return;
	}

	const conflictFiles = await svc.status.getConflictingFiles();
	if (!conflictFiles.length) return;

	// Classify upfront so the confirmation can call out files that can't be resolved by
	// taking the requested side (e.g. UA when staging current, AU when staging incoming —
	// `git checkout --{ours,theirs}` fails when the requested stage is absent). Surfacing
	// the skip count avoids the misleading "all N files" copy when some will be left alone.
	const toCheckoutOurs: string[] = [];
	const toCheckoutTheirs: string[] = [];
	const toDelete: string[] = [];
	let skippedCount = 0;

	for (const f of conflictFiles) {
		const action = classifyConflictAction(f.conflictStatus, resolution);
		switch (action) {
			case 'delete':
				toDelete.push(f.path);
				break;
			case 'take-ours':
				toCheckoutOurs.push(f.path);
				break;
			case 'take-theirs':
				toCheckoutTheirs.push(f.path);
				break;
			case 'unsupported':
				skippedCount++;
				break;
		}
	}

	const resolvableCount = conflictFiles.length - skippedCount;
	if (resolvableCount === 0) {
		void window.showWarningMessage(
			`None of the ${conflictFiles.length} conflicted ${
				conflictFiles.length === 1 ? 'file' : 'files'
			} can be resolved by staging the ${resolution} side.`,
			{ modal: true },
		);
		return;
	}

	const confirmTitle = resolution === 'current' ? 'Stage All Current' : 'Stage All Incoming';
	const discardedSide = resolution === 'current' ? 'incoming' : 'current';
	const skipNote = skippedCount
		? `\n\n${skippedCount} ${
				skippedCount === 1 ? 'file has' : 'files have'
			} no ${resolution} side to take and will be skipped — resolve ${
				skippedCount === 1 ? 'it' : 'them'
			} manually.`
		: '';
	const result = await window.showWarningMessage(
		`Resolve ${resolvableCount} of ${conflictFiles.length} conflicted ${
			conflictFiles.length === 1 ? 'file' : 'files'
		} by staging the ${resolution} side?\n\nThis will discard the ${discardedSide} changes for ${
			resolvableCount === 1 ? 'that file' : 'those files'
		}.${skipNote}`,
		{ modal: true },
		{ title: confirmTitle },
	);
	if (result == null) return;

	const failures: { paths: string[]; reason: unknown }[] = [];

	if (toCheckoutOurs.length) {
		try {
			await svc.ops?.checkoutConflictedPaths?.(toCheckoutOurs, 'ours');
		} catch (ex) {
			failures.push({ paths: toCheckoutOurs, reason: ex });
			toCheckoutOurs.length = 0;
		}
	}
	if (toCheckoutTheirs.length) {
		try {
			await svc.ops?.checkoutConflictedPaths?.(toCheckoutTheirs, 'theirs');
		} catch (ex) {
			failures.push({ paths: toCheckoutTheirs, reason: ex });
			toCheckoutTheirs.length = 0;
		}
	}

	if (toDelete.length) {
		// `git rm -f` removes the working-tree file and stages the deletion atomically,
		// so a locked/permission-denied file fails loudly instead of silently leaving
		// conflict markers staged via a follow-up `git add -A`.
		try {
			await svc.staging?.removeFiles(toDelete, { force: true });
		} catch (ex) {
			failures.push({ paths: toDelete, reason: ex });
			toDelete.length = 0;
		}
	}

	const toStage = [...toCheckoutOurs, ...toCheckoutTheirs];
	if (toStage.length) {
		try {
			await svc.staging?.stageFiles(toStage);
		} catch (ex) {
			failures.push({ paths: toStage, reason: ex });
		}
	}

	const failedCount = failures.reduce((n, f) => n + f.paths.length, 0);

	if (failedCount) {
		void window.showErrorMessage(
			`Failed to resolve ${failedCount} of ${resolvableCount} conflicted ${failedCount === 1 ? 'file' : 'files'}. See logs for details.`,
		);
		for (const f of failures) {
			const error = f.reason instanceof Error ? f.reason : new Error(String(f.reason));
			for (const path of f.paths) {
				Logger.error(error, `resolveAllConflicts: ${path}`);
			}
		}
	}
}
