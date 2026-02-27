/**
 * Git service — git operations, repository state, and change events for webviews.
 *
 * This is the single service for all git and repository concerns:
 * - Commit/branch/PR queries
 * - Repository list and discovery state
 * - Repository change events (add/remove, per-repo changes, working tree FS changes)
 * - Generic git actions (stage, unstage, fetch, push, pull, publish, switchBranch)
 */

import { Disposable, Uri, workspace } from 'vscode';
import type { Container } from '../../../container.js';
import type { FeatureAccess, PlusFeatures } from '../../../features.js';
import * as RepoActions from '../../../git/actions/repository.js';
import type { GitBranch } from '../../../git/models/branch.js';
import type { GitCommit } from '../../../git/models/commit.js';
import { isCommit } from '../../../git/models/commit.js';
import type { GitFileChange, GitFileChangeShape } from '../../../git/models/fileChange.js';
import type { PullRequestShape } from '../../../git/models/pullRequest.js';
import type { RepositoryChange } from '../../../git/models/repository.js';
import { repositoryChanges } from '../../../git/models/repository.js';
import { serializePullRequest } from '../../../git/utils/pullRequest.utils.js';
import { executeCoreGitCommand } from '../../../system/-webview/command.js';
import { serialize } from '../../../system/serialize.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createBufferedCallback, createEventSubscription } from '../eventVisibilityBuffer.js';
import type {
	CommitSelectedEventData,
	EventSubscriber,
	RepositoriesState,
	RepositoryChangeEventData,
	SerializedGitBranch,
	SerializedGitCommit,
	SerializedGitFileChange,
	SerializedRepository,
	Unsubscribe,
} from './types.js';

export class WebviewGitService {
	/**
	 * Fired when a commit is selected (from EventBus).
	 */
	readonly onCommitSelected: EventSubscriber<CommitSelectedEventData>;

	/**
	 * Fired when repository list changes (added/removed).
	 * Pure signal — handler should re-fetch aggregate state as needed.
	 */
	readonly onRepositoriesChanged: EventSubscriber<undefined>;

	/**
	 * Fired when a specific repository changes (branches, commits, etc.).
	 * When gated (hidden webview), changes are aggregated per-repo and
	 * replayed on visibility restore with the union of all change types.
	 */
	readonly onRepositoryChanged: EventSubscriber<RepositoryChangeEventData>;

	/**
	 * Fired when initial repository discovery completes.
	 * Includes the aggregate repositories state at the time of completion.
	 */
	readonly onDiscoveryCompleted: EventSubscriber<RepositoriesState>;

	constructor(
		private readonly container: Container,
		private readonly buffer: EventVisibilityBuffer | undefined,
		private readonly tracker?: SubscriptionTracker,
	) {
		this.onCommitSelected = createEventSubscription<CommitSelectedEventData>(
			buffer,
			'commitSelected',
			'save-last',
			buffered =>
				container.events.on('commit:selected', e => {
					buffered({
						repoPath: e.data.commit.repoPath,
						sha: isCommit(e.data.commit) ? e.data.commit.sha : e.data.commit.ref,
						interaction: e.data.interaction,
						preserveFocus: e.data.preserveFocus,
					});
				}),
			undefined,
			tracker,
		);

		this.onRepositoriesChanged = createEventSubscription<undefined>(
			buffer,
			'repositoriesChanged',
			'signal',
			buffered => container.git.onDidChangeRepositories(() => buffered(undefined)),
			undefined,
			tracker,
		);

		// Smart aggregation: accumulate per-repoPath change sets while hidden,
		// fire one event per affected repo on visibility restore.
		this.onRepositoryChanged = (callback): Unsubscribe => {
			const pendingKey = Symbol('repositoryChanged');
			const pendingRepoChanges = new Map<string, { uri: string; changes: Set<RepositoryChange> }>();

			const disposable = container.git.onDidChangeRepository(e => {
				const data: RepositoryChangeEventData = {
					repoPath: e.repository.path,
					repoUri: e.repository.uri.toString(),
					changes: this.#extractChanges(e),
				};
				if (!buffer || buffer.visible) {
					callback(data);
				} else {
					let existing = pendingRepoChanges.get(data.repoPath);
					if (existing == null) {
						existing = { uri: data.repoUri, changes: new Set() };
						pendingRepoChanges.set(data.repoPath, existing);
					}
					for (const c of data.changes) {
						existing.changes.add(c);
					}
					buffer.addPending(pendingKey, () => {
						for (const [repoPath, entry] of pendingRepoChanges) {
							callback({ repoPath: repoPath, repoUri: entry.uri, changes: [...entry.changes] });
						}
						pendingRepoChanges.clear();
					});
				}
			});
			const unsubscribe = () => {
				buffer?.removePending(pendingKey);
				pendingRepoChanges.clear();
				disposable.dispose();
			};
			return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
		};

		this.onDiscoveryCompleted = (callback): Unsubscribe => {
			const pendingKey = Symbol('discoveryCompleted');
			const buffered = createBufferedCallback(buffer, pendingKey, callback, 'save-last');

			// If discovery is already done, fire immediately
			const discovering = container.git.isDiscoveringRepositories;
			if (discovering == null) {
				buffered(this.#getRepositoriesState());
				return () => {};
			}

			// Wait for discovery to complete, then fire
			let cancelled = false;
			void discovering.then(() => {
				if (!cancelled) {
					buffered(this.#getRepositoriesState());
				}
			});
			const unsubscribe = () => {
				cancelled = true;
				buffer?.removePending(pendingKey);
			};
			return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
		};
	}

	// ============================================================
	// Repository Queries
	// ============================================================

	getRepositories(): Promise<SerializedRepository[]> {
		const repos: SerializedRepository[] = [];
		for (const repo of this.container.git.repositories) {
			repos.push(this.#serializeRepository(repo));
		}
		return Promise.resolve(repos);
	}

	/**
	 * Get aggregate repository state (count, openCount, hasUnsafe, trusted).
	 */
	getRepositoriesState(): Promise<RepositoriesState> {
		return Promise.resolve(this.#getRepositoriesState());
	}

	/**
	 * Check whether initial repository discovery is still in progress.
	 */
	isDiscovering(): Promise<boolean> {
		return Promise.resolve(this.container.git.isDiscoveringRepositories != null);
	}

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

	async getPullRequestForCommit(repoPath: string, sha: string): Promise<PullRequestShape | undefined> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
		if (commit == null) return undefined;
		const pr = await commit.getAssociatedPullRequest();
		return pr != null ? serializePullRequest(pr) : undefined;
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
	fetch(repoPath: string): Promise<void> {
		void RepoActions.fetch(repoPath);
		return Promise.resolve();
	}

	/**
	 * Push to remote.
	 */
	push(repoPath: string): Promise<void> {
		void RepoActions.push(repoPath);
		return Promise.resolve();
	}

	/**
	 * Pull from remote.
	 */
	pull(repoPath: string): Promise<void> {
		void RepoActions.pull(repoPath);
		return Promise.resolve();
	}

	/**
	 * Publish branch to remote.
	 */
	publish(repoPath: string): Promise<void> {
		void executeCoreGitCommand('git.publish', Uri.file(repoPath));
		return Promise.resolve();
	}

	/**
	 * Switch branches.
	 */
	switchBranch(repoPath: string): Promise<void> {
		void RepoActions.switchTo(repoPath);
		return Promise.resolve();
	}

	// ============================================================
	// Private Helpers
	// ============================================================

	#serializeRepository(repo: {
		id: string;
		name: string;
		path: string;
		uri: { toString(): string };
		closed: boolean;
		starred: boolean;
	}): SerializedRepository {
		return {
			id: repo.id,
			name: repo.name,
			path: repo.path,
			uri: repo.uri.toString(),
			closed: repo.closed,
			starred: repo.starred,
		};
	}

	#extractChanges(e: { changed(change: RepositoryChange): boolean }): RepositoryChange[] {
		const changes: RepositoryChange[] = [];
		for (const change of repositoryChanges) {
			if (e.changed(change)) {
				changes.push(change);
			}
		}
		return changes;
	}

	#getRepositoriesState(): RepositoriesState {
		return {
			count: this.container.git.repositoryCount,
			openCount: this.container.git.openRepositoryCount,
			hasUnsafe: this.container.git.hasUnsafeRepositories(),
			trusted: workspace.isTrusted,
		};
	}
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
