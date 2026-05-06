/**
 * Repository service — per-repo operations for webviews.
 *
 * Handles all operations scoped to a specific repository:
 * - Commit, branch, and signature queries
 * - WIP/working tree queries
 * - Git actions (stage, unstage, fetch, push, pull, publish, switchBranch)
 * - Per-repo change events (working tree FS changes, filtered repository changes)
 */

import { Disposable, Uri, window } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFileChange, GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { repositoryChanges } from '@gitlens/git/models/repository.js';
import type { CommitSignature } from '@gitlens/git/models/signature.js';
import type { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import { getConflictIncomingRef, resolveConflictFilePaths } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { DiffWithCommandArgs } from '../../../commands/diffWith.js';
import type { Container } from '../../../container.js';
import type { FeatureAccess, PlusFeatures } from '../../../features.js';
import * as BranchActions from '../../../git/actions/branch.js';
import * as RepoActions from '../../../git/actions/repository.js';
import { GitUri } from '../../../git/gitUri.js';
import { getCommitSignature } from '../../../git/utils/-webview/commit.utils.js';
import {
	resolveAllConflicts as resolveAllConflictsHelper,
	stageConflictResolution as stageConflictResolutionHelper,
} from '../../../git/utils/-webview/conflictResolution.utils.js';
import { countConflictMarkers } from '../../../git/utils/-webview/mergeConflicts.utils.js';
import { executeCommand, executeCoreCommand } from '../../../system/-webview/command.js';
import { serialize } from '../../../system/serialize.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { bufferEventHandler } from '../eventVisibilityBuffer.js';
import type {
	CommitSignatureShape,
	RepositoryChangeEventData,
	SerializedGitBranch,
	SerializedGitCommit,
	SerializedGitFileChange,
	Unsubscribe,
	WipStatus,
	WipSummary,
} from './types.js';

export class RepositoryService {
	constructor(
		private readonly container: Container,
		private readonly buffer: EventVisibilityBuffer | undefined,
		private readonly tracker?: SubscriptionTracker,
	) {}

	// ============================================================
	// Per-repo Events
	// ============================================================

	/**
	 * Watch a repository for working tree file changes (saves, creates, deletes).
	 * Git-level changes (index, head) come via `onRepositoryChanged` instead.
	 * Pure signal — the repoPath is known from the subscription parameter.
	 * @param repoPath - Repository to watch
	 * @param callback - Called when working tree files change
	 * @returns Unsubscribe function that stops watching
	 */
	onRepositoryWorkingChanged(repoPath: string, callback: () => void): Unsubscribe {
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return () => {};

		const pendingKey = Symbol(`repositoryWorking:${repoPath}`);
		const buffered = bufferEventHandler<undefined>(this.buffer, pendingKey, callback, 'signal', undefined);
		const disposable = Disposable.from(
			repo.watchWorkingTree(1000),
			repo.onDidChangeWorkingTree(() => buffered(undefined)),
		);
		const unsubscribe = () => {
			this.buffer?.removePending(pendingKey);
			disposable.dispose();
		};
		return this.tracker != null ? this.tracker.track(unsubscribe) : unsubscribe;
	}

	/**
	 * Fired when a specific repository changes (branches, commits, etc.).
	 * Filtered to only fire for the specified repo.
	 * When gated (hidden webview), changes are aggregated and
	 * replayed on visibility restore with the union of all change types.
	 * @param repoPath - Repository to watch for changes
	 * @param callback - Called with change event data
	 * @returns Unsubscribe function that stops watching
	 */
	onRepositoryChanged(repoPath: string, callback: (data: RepositoryChangeEventData) => void): Unsubscribe {
		const pendingKey = Symbol(`repositoryChanged:${repoPath}`);
		const pendingChanges = new Set<RepositoryChange>();
		let pendingUri: string | undefined;

		const disposable = this.container.git.onDidChangeRepository(e => {
			if (e.repository.path !== repoPath) return;

			const data: RepositoryChangeEventData = {
				repoPath: e.repository.path,
				repoUri: e.repository.uri.toString(),
				changes: extractRepositoryChanges(e),
			};
			if (!this.buffer || this.buffer.visible) {
				callback(data);
			} else {
				pendingUri = data.repoUri;
				for (const c of data.changes) {
					pendingChanges.add(c);
				}
				this.buffer.addPending(pendingKey, () => {
					callback({ repoPath: repoPath, repoUri: pendingUri!, changes: [...pendingChanges] });
					pendingChanges.clear();
					pendingUri = undefined;
				});
			}
		});
		const unsubscribe = () => {
			this.buffer?.removePending(pendingKey);
			pendingChanges.clear();
			disposable.dispose();
		};
		return this.tracker != null ? this.tracker.track(unsubscribe) : unsubscribe;
	}

	// ============================================================
	// Commit & Branch Queries
	// ============================================================

	async getCommit(repoPath: string, sha: string): Promise<SerializedGitCommit | undefined> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
		return commit != null ? serializeCommit(commit) : undefined;
	}

	async getCommitFiles(repoPath: string, sha: string): Promise<SerializedGitFileChange[]> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
		if (commit == null) return [];
		await GitCommit.ensureFullDetails(commit);
		const files = commit.fileset?.files;
		if (files == null || files.length === 0) return [];
		return files.map(serializeFileChange);
	}

	async getBranch(repoPath: string, name: string): Promise<SerializedGitBranch | undefined> {
		const branch = await this.container.git.getRepositoryService(repoPath).branches.getBranch(name);
		return branch != null ? serializeBranch(branch) : undefined;
	}

	async getCurrentBranch(repoPath: string): Promise<SerializedGitBranch | undefined> {
		const branch = await this.container.git.getRepositoryService(repoPath).branches.getBranch();
		return branch != null ? serializeBranch(branch) : undefined;
	}

	async getCommitReachability(
		repoPath: string,
		sha: string,
		signal?: AbortSignal,
	): Promise<GitCommitReachability | undefined> {
		return this.container.git.getRepositoryService(repoPath).commits.getCommitReachability?.(sha, signal);
	}

	async getCommitSignature(
		repoPath: string,
		sha: string,
		signal?: AbortSignal,
	): Promise<CommitSignatureShape | undefined> {
		signal?.throwIfAborted();
		const signature = await getCommitSignature(repoPath, sha);
		signal?.throwIfAborted();
		return signature != null ? serializeSignature(signature) : undefined;
	}

	async getFeatureAccess(feature: PlusFeatures, repoUri?: string): Promise<FeatureAccess> {
		const access =
			repoUri != null
				? await this.container.git.access(feature, Uri.parse(repoUri))
				: await this.container.git.access(feature);
		return serialize(access);
	}

	async hasRemotes(repoPath: string): Promise<boolean> {
		const remotes = await this.container.git.getRepositoryService(repoPath).remotes.getRemotes();
		return remotes.length > 0;
	}

	// ============================================================
	// Git Actions
	// ============================================================

	/**
	 * Stage a file. When the file is conflicted and still contains conflict markers, prompts
	 * the user before staging so they don't accidentally commit unresolved markers.
	 */
	async stageFile(file: GitFileChangeShape): Promise<void> {
		if (isConflictStatus(file.status)) {
			const uri = Uri.joinPath(Uri.file(file.repoPath), file.path);
			const markers = await countConflictMarkers(uri);
			if (markers > 0 && !(await this.confirmStageWithConflictMarkers(uri, file.path, markers))) {
				return;
			}
		}
		await this.container.git.getRepositoryService(file.repoPath).staging?.stageFile(file.path);
	}

	/**
	 * Unstage a file.
	 */
	async unstageFile(file: GitFileChangeShape): Promise<void> {
		await this.container.git.getRepositoryService(file.repoPath).staging?.unstageFile(file.path);
	}

	/**
	 * Open the rebase-editor-style conflict changes diff for a paused-operation conflicted file.
	 * `side='current'` shows the user's working-tree side vs the merge-base; `side='incoming'`
	 * shows the incoming (theirs) side vs the merge-base.
	 */
	async openConflictChanges(file: GitFileChangeShape, side: 'current' | 'incoming'): Promise<void> {
		const normalizedPath = normalizePath(file.path);
		const svc = this.container.git.getRepositoryService(file.repoPath);
		const pausedStatus = await svc.pausedOps?.getPausedOperationStatus?.();
		if (pausedStatus?.mergeBase == null) {
			Logger.warn('openConflictChanges: paused-operation status or merge-base unavailable');
			void window.showWarningMessage('Unable to open conflict changes — operation status unavailable');
			return;
		}

		const incomingRef = getConflictIncomingRef(pausedStatus) ?? pausedStatus.HEAD.ref;
		const mergeBase = pausedStatus.mergeBase;

		// Resolve rename-aware paths (mirrors mergeConflictFileNode.ts pattern)
		const [currentFilesResult, incomingFilesResult] = await Promise.allSettled([
			svc.diff.getDiffStatus(mergeBase, 'HEAD', { renameLimit: 0 }),
			svc.diff.getDiffStatus(mergeBase, incomingRef, { renameLimit: 0 }),
		]);
		const currentFiles = getSettledValue(currentFilesResult);
		const incomingFiles = getSettledValue(incomingFilesResult);

		let lhsPath: string;
		let rhsPath: string;
		if (side === 'current') {
			({ lhsPath, rhsPath } = resolveConflictFilePaths(currentFiles, incomingFiles, normalizedPath));
		} else {
			// Swap: when viewing incoming changes, "my side" is the incoming ref
			({ lhsPath, rhsPath } = resolveConflictFilePaths(incomingFiles, currentFiles, normalizedPath));
		}

		const ref = side === 'current' ? 'HEAD' : incomingRef;

		await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
			lhs: {
				sha: mergeBase,
				uri: GitUri.fromFile(lhsPath, file.repoPath, mergeBase),
				title: `${lhsPath} (merge-base)`,
			},
			rhs: {
				sha: ref,
				uri: GitUri.fromFile(rhsPath, file.repoPath, ref),
				title: `${rhsPath} (${side === 'current' ? 'current' : 'incoming'})`,
			},
			repoPath: file.repoPath,
			showOptions: { preserveFocus: false, preview: true },
		});
	}

	/**
	 * Stage all working tree changes. When any conflicted file still contains conflict markers,
	 * prompts the user once before staging the batch.
	 */
	async stageAll(repoPath: string): Promise<void> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const status = await svc.status.getStatus();
		if (status?.hasConflicts) {
			const conflictedPaths = status.files.filter(f => isConflictStatus(f.status)).map(f => f.path);
			if (conflictedPaths.length > 0) {
				const counts = await Promise.allSettled(
					conflictedPaths.map(p => countConflictMarkers(Uri.joinPath(Uri.file(repoPath), p))),
				);
				const filesWithMarkers = conflictedPaths.filter((_, i) => (getSettledValue(counts[i]) ?? 0) > 0).length;
				if (filesWithMarkers > 0 && !(await this.confirmStageAllWithConflictMarkers(filesWithMarkers))) {
					return;
				}
			}
		}
		await svc.staging?.stageAll();
	}

	private async confirmStageWithConflictMarkers(uri: Uri, path: string, markers: number): Promise<boolean> {
		const stage = 'Stage Anyway';
		const open = 'Open File';
		const choice = await window.showWarningMessage(
			`"${path}" still contains ${pluralize('unresolved conflict marker', markers)}. Staging will commit them as-is.`,
			{ modal: true },
			stage,
			open,
		);
		if (choice === open) {
			await executeCoreCommand('vscode.open', uri);
			return false;
		}
		return choice === stage;
	}

	private async confirmStageAllWithConflictMarkers(fileCount: number): Promise<boolean> {
		const stage = 'Stage All Anyway';
		const choice = await window.showWarningMessage(
			`${pluralize('file', fileCount)} still ${fileCount === 1 ? 'contains' : 'contain'} unresolved conflict markers. Staging will commit them as-is.`,
			{ modal: true },
			stage,
		);
		return choice === stage;
	}

	/**
	 * Resolve a single conflicted file by taking either the current (HEAD/ours) or incoming
	 * (theirs) side, then stage it. Operation-agnostic — works for any paused operation type
	 * (rebase, merge, cherry-pick, revert).
	 */
	async stageConflictResolution(
		file: GitFileChangeShape & { status: GitFileConflictStatus },
		resolution: 'current' | 'incoming',
	): Promise<void> {
		await stageConflictResolutionHelper(this.container, file, resolution);
	}

	/**
	 * Resolve every conflicted file at once by staging the requested side. Currently scoped to
	 * paused rebases.
	 */
	async resolveAllConflicts(repoPath: string, resolution: 'current' | 'incoming'): Promise<void> {
		await resolveAllConflictsHelper(this.container, repoPath, resolution);
	}

	/**
	 * Unstage all staged changes.
	 */
	async unstageAll(repoPath: string): Promise<void> {
		await this.container.git.getRepositoryService(repoPath).staging?.unstageAll();
	}

	/**
	 * Commit staged changes.
	 */
	async commit(repoPath: string, message: string, options?: { all?: boolean; amend?: boolean }): Promise<void> {
		await this.container.git.getRepositoryService(repoPath).ops?.commit(message, options);
	}

	/**
	 * Get the last commit message (for amend mode).
	 */
	async getLastCommitMessage(repoPath: string): Promise<string | undefined> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit('HEAD');
		return commit?.message;
	}

	/**
	 * Fetch from remote.
	 */
	async fetch(repoPath: string): Promise<void> {
		await RepoActions.fetch(repoPath);
	}

	/**
	 * Push to remote.
	 */
	async push(repoPath: string): Promise<void> {
		await RepoActions.push(repoPath);
	}

	/**
	 * Pull from remote.
	 */
	async pull(repoPath: string): Promise<void> {
		await RepoActions.pull(repoPath);
	}

	/**
	 * Switch branches.
	 */
	async switchBranch(repoPath: string): Promise<void> {
		await RepoActions.switchTo(repoPath);
	}

	/**
	 * Create a new branch.
	 */
	async createBranch(repoPath: string): Promise<void> {
		await BranchActions.create(repoPath);
	}

	// ============================================================
	// Working Tree / WIP Queries
	// ============================================================

	/**
	 * Get a lightweight WIP summary for a repository (diff stats, conflicts, paused op status).
	 * Used by Home overview for per-branch WIP display.
	 */
	async getWipSummary(repoPath: string): Promise<WipSummary | undefined> {
		const [statusResult, pausedOpResult] = await Promise.allSettled([
			this.container.git.getRepositoryService(repoPath).status.getStatus(),
			this.container.git.getRepositoryService(repoPath).pausedOps?.getPausedOperationStatus?.(),
		]);

		const status = getSettledValue(statusResult);
		if (status == null) return undefined;

		return {
			workingTreeState: status.diffStatus,
			hasConflicts: status.hasConflicts,
			conflictsCount: status.conflicts.length,
			pausedOpStatus: getSettledValue(pausedOpResult),
		};
	}

	/**
	 * Get full working tree status (file list + branch + summary).
	 * Used by Commit Details for WIP file display, Timeline for pseudo-commits.
	 */
	async getWipStatus(repoPath: string): Promise<WipStatus | undefined> {
		const status = await this.container.git.getRepositoryService(repoPath).status.getStatus();
		if (status == null) return undefined;

		return {
			branch: status.branch,
			files: status.files.map(f => serializeStatusFile(f)),
			summary: {
				workingTreeState: status.diffStatus,
				hasConflicts: status.hasConflicts,
				conflictsCount: status.conflicts.length,
			},
		};
	}
}

// ============================================================
// Shared Helpers
// ============================================================

export function extractRepositoryChanges(e: { changed(change: RepositoryChange): boolean }): RepositoryChange[] {
	const changes: RepositoryChange[] = [];
	for (const change of repositoryChanges) {
		if (e.changed(change)) {
			changes.push(change);
		}
	}
	return changes;
}

// ============================================================
// Serialization Helpers
// ============================================================

function serializeCommit(commit: GitCommit): SerializedGitCommit {
	return {
		sha: commit.sha,
		shortSha: commit.shortSha,
		repoPath: commit.repoPath,
		author: { name: commit.author.name, email: commit.author.email, date: commit.author.date.getTime() },
		committer: {
			name: commit.committer.name,
			email: commit.committer.email,
			date: commit.committer.date.getTime(),
		},
		parents: commit.parents,
		message: commit.message,
		summary: commit.summary,
		stashNumber: commit.stashNumber,
		stashOnRef: commit.stashOnRef,
		refType: commit.refType,
	};
}

function serializeBranch(branch: GitBranch): SerializedGitBranch {
	return {
		repoPath: branch.repoPath,
		id: branch.id,
		name: branch.name,
		refName: branch.refName,
		remote: branch.remote,
		current: branch.current,
		date: branch.date?.getTime(),
		sha: branch.sha,
		upstream: branch.upstream,
		detached: branch.detached,
		rebasing: branch.rebasing,
		worktree: branch.worktree,
	};
}

function serializeSignature(signature: CommitSignature): CommitSignatureShape {
	return {
		status: signature.status,
		format: signature.format,
		signer: signature.signer,
		keyId: signature.keyId,
		fingerprint: signature.fingerprint,
		trustLevel: signature.trustLevel,
		errorMessage: signature.errorMessage,
	};
}

function serializeFileChange(file: GitFileChange): SerializedGitFileChange {
	return {
		repoPath: file.repoPath,
		path: file.path,
		status: file.status,
		originalPath: file.originalPath,
		staged: file.staged,
		mode: file.mode,
		submodule: file.submodule,
		previousSha: file.previousSha,
		stats: file.stats,
	};
}

function serializeStatusFile(file: GitStatusFile): SerializedGitFileChange {
	return {
		repoPath: file.repoPath,
		path: file.path,
		status: file.status,
		originalPath: file.originalPath,
		staged: file.staged,
		submodule: file.submodule,
	};
}
