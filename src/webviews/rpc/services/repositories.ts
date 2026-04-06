/**
 * Repositories service — workspace-level repository awareness for webviews.
 *
 * Handles repository list, aggregate state, discovery status, and workspace-level events:
 * - Repository list queries and serialization
 * - Repository add/remove change events
 * - Global repository change events (aggregated per-repo while hidden)
 * - Discovery completion events
 * - Commit selection events (workspace-level, from EventBus)
 */

import { workspace } from 'vscode';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { Container } from '../../../container.js';
import type { RepositoryChange } from '../../../git/models/repository.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { bufferEventHandler, createRpcEventSubscription } from '../eventVisibilityBuffer.js';
import { extractRepositoryChanges } from './repository.js';
import type {
	CommitSelectedEventData,
	RepositoriesState,
	RepositoryChangeEventData,
	RpcEventSubscription,
	SerializedRepository,
	Unsubscribe,
} from './types.js';

export class RepositoriesService {
	/**
	 * Fired when a commit is selected (from EventBus).
	 */
	readonly onCommitSelected: RpcEventSubscription<CommitSelectedEventData>;

	/**
	 * Fired when repository list changes (added/removed).
	 * Pure signal — handler should re-fetch aggregate state as needed.
	 */
	readonly onRepositoriesChanged: RpcEventSubscription<undefined>;

	/**
	 * Fired when a specific repository changes (branches, commits, etc.).
	 * When gated (hidden webview), changes are aggregated per-repo and
	 * replayed on visibility restore with the union of all change types.
	 */
	readonly onRepositoryChanged: RpcEventSubscription<RepositoryChangeEventData>;

	/**
	 * Fired when initial repository discovery completes.
	 * Includes the aggregate repositories state at the time of completion.
	 */
	readonly onDiscoveryCompleted: RpcEventSubscription<RepositoriesState>;

	constructor(
		private readonly container: Container,
		private readonly buffer: EventVisibilityBuffer | undefined,
		private readonly tracker?: SubscriptionTracker,
	) {
		this.onCommitSelected = createRpcEventSubscription<CommitSelectedEventData>(
			buffer,
			'commitSelected',
			'save-last',
			buffered =>
				container.events.on('commit:selected', e => {
					buffered({
						repoPath: e.data.commit.repoPath,
						sha: GitCommit.is(e.data.commit) ? e.data.commit.sha : e.data.commit.ref,
						interaction: e.data.interaction,
						preserveFocus: e.data.preserveFocus,
					});
				}),
			undefined,
			tracker,
		);

		this.onRepositoriesChanged = createRpcEventSubscription<undefined>(
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
					changes: extractRepositoryChanges(e),
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
			const buffered = bufferEventHandler(buffer, pendingKey, callback, 'save-last');

			// If discovery is already done, fire immediately
			const discovering = container.git.isDiscoveringRepositories;
			if (discovering == null) {
				buffered(this.#getRepositoriesState());
				return () => {
					buffer?.removePending(pendingKey);
				};
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

	#getRepositoriesState(): RepositoriesState {
		return {
			count: this.container.git.repositoryCount,
			openCount: this.container.git.openRepositoryCount,
			hasUnsafe: this.container.git.hasUnsafeRepositories(),
			trusted: workspace.isTrusted,
		};
	}
}
