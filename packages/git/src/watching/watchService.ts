import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { isDescendant, relative } from '@gitlens/utils/path.js';
import type { GitDir, RepositoryChange } from '../models/repository.js';
import type { WatcherRepoChangeEvent } from './changeEvent.js';
import type { GitIgnoreFilter } from './gitIgnoreFilter.js';
import type { FileWatcher, FileWatchingProvider } from './provider.js';
import { shouldIgnoreWorkingTreePath } from './watcherPatterns.js';
import type { WatchGroupHooks } from './watchGroup.js';
import { WatchGroup } from './watchGroup.js';
import { RepositoryWatchSession } from './watchSession.js';

export interface WatchServiceOptions {
	readonly watchingProvider: FileWatchingProvider;
	/** Default debounce for repo changes when subscriber doesn't specify. Default: 250ms */
	readonly defaultRepoDelayMs?: number;
	/** Default debounce for working tree changes when subscriber doesn't specify. Default: 2500ms */
	readonly defaultWorkingTreeDelayMs?: number;
	/** Returns a GitIgnoreFilter for a given repo. When absent or returns undefined, gitignore filtering is skipped. */
	readonly getIgnoreFilter?: (repoPath: string, gitDirPath: string) => GitIgnoreFilter | undefined;
}

export interface WatchHooks {
	/** Called when FETCH_HEAD changed (for last-fetched tracking) */
	readonly onFetchHeadChanged?: (repoPath: string) => void;
	/** Called when .git/info/exclude changed */
	readonly onIgnoresChanged?: (repoPath: string) => void;
	/** Called when .gitignore changed in the working tree (extension watches this separately) */
	readonly onGitIgnoreChanged?: (repoPath: string) => void;
}

export interface WatchHandle {
	readonly session: RepositoryWatchSession;
	dispose(): void;
}

interface SessionRecord {
	readonly session: RepositoryWatchSession;
	readonly gitDir: GitDir;
	readonly watchHooks?: WatchHooks;
	refCount: number;
}

/**
 * Global service that multiplexes repository watching across all repos.
 *
 * Manages:
 * - Session map: one `RepositoryWatchSession` per repo path (ref-counted)
 * - Watch groups: shared `.git` watchers across worktrees
 * - Working tree watchers: per-repo filesystem watchers with gitignore filtering
 *
 * Sessions and watch groups are created lazily on first `subscribe()`
 * within a session, and destroyed when the last subscriber leaves.
 */
export class RepositoryWatchService implements UnifiedDisposable {
	private readonly _onDidChangeRepository = new Emitter<WatcherRepoChangeEvent>();
	/** Global multiplexed event for ALL watched repos */
	get onDidChangeRepository(): Event<WatcherRepoChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	private readonly defaultRepoDelayMs?: number;
	private readonly defaultWorkingTreeDelayMs?: number;
	private readonly getIgnoreFilter?: (repoPath: string, gitDirPath: string) => GitIgnoreFilter | undefined;
	private readonly provider: FileWatchingProvider;

	private readonly sessionMap = new Map<string, SessionRecord>();
	private readonly watchGroups = new Map<string, WatchGroup>();
	private readonly wtWatchers = new Map<string, { watcher: FileWatcher; filter?: GitIgnoreFilter }>();
	private _disposed = false;

	constructor(options: WatchServiceOptions) {
		this.provider = options.watchingProvider;
		this.defaultRepoDelayMs = options.defaultRepoDelayMs;
		this.defaultWorkingTreeDelayMs = options.defaultWorkingTreeDelayMs;
		this.getIgnoreFilter = options.getIgnoreFilter;
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;

		for (const record of this.sessionMap.values()) {
			this.disposeSessionRecord(record);
		}
		this.sessionMap.clear();

		for (const group of this.watchGroups.values()) {
			group.dispose();
		}
		this.watchGroups.clear();

		for (const entry of this.wtWatchers.values()) {
			entry.watcher.dispose();
		}
		this.wtWatchers.clear();

		this._onDidChangeRepository.dispose();
	}

	/**
	 * Start watching a repository. Reference-counted:
	 * same repoPath → same session (refCount++).
	 * Worktrees sharing a .git dir share the WatchGroup.
	 *
	 * Returns a handle with the session and a dispose function.
	 * Disposing the handle decrements the ref count.
	 */
	watch(repoPath: string, gitDir: GitDir, watchHooks?: WatchHooks): WatchHandle | undefined {
		if (this._disposed) return undefined;

		let record = this.sessionMap.get(repoPath);
		if (record != null) {
			record.refCount++;
		} else {
			const session = new RepositoryWatchSession({
				repoPath: repoPath,
				defaultRepoDelayMs: this.defaultRepoDelayMs,
				defaultWorkingTreeDelayMs: this.defaultWorkingTreeDelayMs,
				lifecycle: {
					onFirstRepoSubscriber: (): void => {
						const rec = this.sessionMap.get(repoPath);
						if (rec != null) {
							this.connectToWatchGroup(rec);
						}
					},
					onLastRepoSubscriber: (): void => {
						const rec = this.sessionMap.get(repoPath);
						if (rec != null) {
							this.disconnectFromWatchGroup(rec);
						}
					},
					onFirstWorkingTreeSubscriber: (): void => {
						const rec = this.sessionMap.get(repoPath);
						if (rec != null) {
							this.startWorkingTreeWatcher(rec);
						}
					},
					onLastWorkingTreeSubscriber: (): void => {
						this.stopWorkingTreeWatcher(repoPath);
					},
				},
				onDidFireRepoChange: (event): void => {
					this._onDidChangeRepository.fire(event);
				},
			});

			record = {
				session: session,
				gitDir: gitDir,
				watchHooks: watchHooks,
				refCount: 1,
			};
			this.sessionMap.set(repoPath, record);
		}

		const sessionRef = record.session;
		let handleDisposed = false;

		return {
			session: sessionRef,
			dispose: (): void => {
				if (handleDisposed) return;
				handleDisposed = true;

				const rec = this.sessionMap.get(repoPath);
				if (rec == null) return;

				rec.refCount--;
				if (rec.refCount <= 0) {
					this.sessionMap.delete(repoPath);
					this.disposeSessionRecord(rec);
				}
			},
		};
	}

	/** Get an existing session by repo path */
	getSession(repoPath: string): RepositoryWatchSession | undefined {
		return this.sessionMap.get(repoPath)?.session;
	}

	/** Suspend all sessions */
	suspendAll(): void {
		for (const record of this.sessionMap.values()) {
			record.session.suspend();
		}
	}

	/** Resume all sessions, with optional per-session delay */
	resumeAll(getDelay?: (session: RepositoryWatchSession) => number): void {
		for (const record of this.sessionMap.values()) {
			const delayMs = getDelay?.(record.session);
			record.session.resume(delayMs);
		}
	}

	private getOrCreateWatchGroup(commonGitDir: string): WatchGroup {
		let group = this.watchGroups.get(commonGitDir);
		if (group == null) {
			group = new WatchGroup(commonGitDir, this.provider);
			this.watchGroups.set(commonGitDir, group);
		}
		return group;
	}

	private maybeDisposeWatchGroup(commonGitDir: string): void {
		const group = this.watchGroups.get(commonGitDir);
		if (group == null) return;

		if (group.sessions.size === 0) {
			group.dispose();
			this.watchGroups.delete(commonGitDir);
		}
	}

	private connectToWatchGroup(record: SessionRecord): void {
		const { session, gitDir, watchHooks } = record;
		const commonGitDir = (gitDir.commonUri ?? gitDir.uri).fsPath;
		const group = this.getOrCreateWatchGroup(commonGitDir);

		const hooks: WatchGroupHooks = {
			onRepoChanged: function (_repoPath: string, changes: RepositoryChange[]): void {
				session.pushRepoChanges(changes);
			},
			onFetchHeadChanged: function (repoPath: string): void {
				watchHooks?.onFetchHeadChanged?.(repoPath);
			},
			onIgnoresChanged: (repoPath: string): void => {
				this.refreshWorkingTreeFilter(repoPath);
				watchHooks?.onIgnoresChanged?.(repoPath);
			},
		};

		group.addSession(session.repoPath, gitDir, hooks);
	}

	private disconnectFromWatchGroup(record: SessionRecord): void {
		const { session, gitDir } = record;
		const commonGitDir = (gitDir.commonUri ?? gitDir.uri).fsPath;
		const group = this.watchGroups.get(commonGitDir);
		if (group == null) return;

		group.removeSession(session.repoPath);
		this.maybeDisposeWatchGroup(commonGitDir);
	}

	private startWorkingTreeWatcher(record: SessionRecord): void {
		const { session, gitDir, watchHooks } = record;
		const repoPath = session.repoPath;
		if (this.wtWatchers.has(repoPath)) return;

		let filter: GitIgnoreFilter | undefined;
		if (this.getIgnoreFilter != null) {
			filter = this.getIgnoreFilter(repoPath, gitDir.uri.fsPath);
		}

		// Buffer events while the gitignore filter loads, then replay
		let filterReady = filter == null;
		let buffered: string[] | undefined = filter != null ? [] : undefined;

		if (filter != null) {
			void filter
				.ready()
				.then(() => {
					filterReady = true;
					if (buffered?.length) {
						const paths = filterWorkingTreePaths(buffered, repoPath, filter);
						if (paths.length > 0) {
							session.pushWorkingTreeChanges(paths);
						}
					}
					buffered = undefined;
				})
				.catch(() => {
					filterReady = true;
					buffered = undefined;
				});
		}

		const watcher = this.provider.createWatcher(repoPath, '**', event => {
			// Fast noise check (node_modules, .git, .watchman-cookie-)
			if (shouldIgnoreWorkingTreePath(event.path)) return;

			// Detect .gitignore changes — refresh the filter and notify the host
			const relativePath = isDescendant(event.path, repoPath) ? relative(repoPath, event.path) : undefined;
			if (relativePath === '.gitignore') {
				if (filter != null) {
					void filter.refresh();
				}
				watchHooks?.onGitIgnoreChanged?.(repoPath);
				// Don't push .gitignore itself as a working tree change
				return;
			}

			if (!filterReady) {
				// Buffer until gitignore filter is ready
				buffered?.push(event.path);
				return;
			}

			// Gitignore filter (sync after ready)
			if (filter != null) {
				if (relativePath != null && filter.isIgnored(relativePath)) return;
			}

			session.pushWorkingTreeChanges([event.path]);
		});

		this.wtWatchers.set(repoPath, { watcher: watcher, filter: filter });
	}

	private stopWorkingTreeWatcher(repoPath: string): void {
		const entry = this.wtWatchers.get(repoPath);
		if (entry == null) return;

		entry.watcher.dispose();
		this.wtWatchers.delete(repoPath);
	}

	private refreshWorkingTreeFilter(repoPath: string): void {
		const entry = this.wtWatchers.get(repoPath);
		if (entry?.filter != null) {
			void entry.filter.refresh();
		}
	}

	private disposeSessionRecord(record: SessionRecord): void {
		this.disconnectFromWatchGroup(record);
		this.stopWorkingTreeWatcher(record.session.repoPath);
		record.session.dispose();
	}
}

function filterWorkingTreePaths(absolutePaths: string[], repoPath: string, filter: GitIgnoreFilter): string[] {
	const result: string[] = [];
	for (const p of absolutePaths) {
		if (!isDescendant(p, repoPath)) continue;
		const relativePath = relative(repoPath, p);
		if (!filter.isIgnored(relativePath)) {
			result.push(p);
		}
	}
	return result;
}
