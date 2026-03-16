/**
 * Repository service — per-repo operations for webviews.
 *
 * Handles all operations scoped to a specific repository:
 * - Commit, branch, and signature queries
 * - WIP/working tree queries
 * - Git actions (stage, unstage, fetch, push, pull, publish, switchBranch)
 * - Per-repo change events (working tree FS changes, filtered repository changes)
 */

import { CancellationTokenSource, Disposable, Uri } from 'vscode';
import type { Container } from '../../../container.js';
import type { FeatureAccess, PlusFeatures } from '../../../features.js';
import * as RepoActions from '../../../git/actions/repository.js';
import type { GitCommitReachability } from '../../../git/gitProvider.js';
import type { GitBranch } from '../../../git/models/branch.js';
import type { GitCommit } from '../../../git/models/commit.js';
import type { GitFileChange, GitFileChangeShape } from '../../../git/models/fileChange.js';
import type { RepositoryChange } from '../../../git/models/repository.js';
import { repositoryChanges } from '../../../git/models/repository.js';
import type { CommitSignature } from '../../../git/models/signature.js';
import { executeCoreGitCommand } from '../../../system/-webview/command.js';
import { getSettledValue } from '../../../system/promise.js';
import { serialize } from '../../../system/serialize.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createBufferedCallback } from '../eventVisibilityBuffer.js';
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
		const buffered = createBufferedCallback<undefined>(
			this.buffer,
			pendingKey,
			callback as (data: undefined) => void,
			'signal',
			undefined,
		);
		const disposable = Disposable.from(
			repo.watchFileSystem(1000),
			repo.onDidChangeFileSystem(() => buffered(undefined)),
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
		await commit.ensureFullDetails();
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
		const cancellation = new CancellationTokenSource();
		const onAbort = () => cancellation.cancel();
		signal?.addEventListener('abort', onAbort, { once: true });

		try {
			if (signal?.aborted) {
				cancellation.cancel();
			}
			return await this.container.git
				.getRepositoryService(repoPath)
				.commits.getCommitReachability?.(sha, cancellation.token);
		} finally {
			signal?.removeEventListener('abort', onAbort);
			cancellation.dispose();
		}
	}

	async getCommitSignature(repoPath: string, sha: string): Promise<CommitSignatureShape | undefined> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
		if (commit == null) return undefined;
		const signature = await commit.getSignature();
		return signature != null ? serializeSignature(signature) : undefined;
	}

	async getFeatureAccess(feature: PlusFeatures, repoUri?: string): Promise<FeatureAccess> {
		const access =
			repoUri != null
				? await this.container.git.access(feature, Uri.parse(repoUri))
				: await this.container.git.access(feature);
		return serialize(access) as FeatureAccess;
	}

	// ============================================================
	// Git Actions
	// ============================================================

	/**
	 * Stage a file.
	 */
	async stageFile(file: GitFileChangeShape): Promise<void> {
		await this.container.git.getRepositoryService(file.repoPath).staging?.stageFile(file.path);
	}

	/**
	 * Unstage a file.
	 */
	async unstageFile(file: GitFileChangeShape): Promise<void> {
		await this.container.git.getRepositoryService(file.repoPath).staging?.unstageFile(file.path);
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
	 * Publish branch to remote.
	 */
	async publish(repoPath: string): Promise<void> {
		await executeCoreGitCommand('git.publish', Uri.file(repoPath));
	}

	/**
	 * Switch branches.
	 */
	async switchBranch(repoPath: string): Promise<void> {
		await RepoActions.switchTo(repoPath);
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
			workingTreeState: status.getDiffStatus(),
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
			files: status.files.map(f => ({
				repoPath: f.repoPath,
				path: f.path,
				status: f.status,
				originalPath: f.originalPath,
				submodule: f.submodule,
			})),
			summary: {
				workingTreeState: status.getDiffStatus(),
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
