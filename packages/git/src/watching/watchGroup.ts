import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { isDescendant, relative } from '@gitlens/utils/path.js';
import type { GitDir, RepositoryChange } from '../models/repository.js';
import { classifyGitDirChange } from './classifyChange.js';
import type { FileWatcher, FileWatchEvent, FileWatchingProvider } from './provider.js';
import { dotGitGlobCombined, dotGitGlobCommon, dotGitGlobRoot, shouldIgnoreRepoPath } from './watcherPatterns.js';

/**
 * Hooks that the WatchGroup fires when events are interpreted.
 * These are raw, un-debounced events — the session handles debouncing.
 */
export interface WatchGroupHooks {
	readonly onRepoChanged: (repoPath: string, changes: RepositoryChange[]) => void;
	readonly onFetchHeadChanged?: (repoPath: string) => void;
	readonly onIgnoresChanged?: (repoPath: string) => void;
}

/**
 * Tracks one session's connection to a WatchGroup.
 * Each session has its own root watcher but shares the common watcher.
 */
interface SessionEntry {
	readonly repoPath: string;
	readonly gitDirPath: string;
	readonly rootWatcher: FileWatcher;
	readonly hooks: WatchGroupHooks;
}

/**
 * Manages filesystem watchers for a single physical `.git` directory,
 * shared across all worktrees that reference it.
 *
 * Structure:
 * - 1 common watcher: config, refs/**, info/exclude, etc.
 * - N root watchers: one per worktree (index, HEAD, *_HEAD, etc.)
 *
 * For a standard (non-worktree) repo, the common and root directories
 * are the same, but we still create separate watchers for clean separation.
 */
export class WatchGroup implements UnifiedDisposable {
	private readonly _sessions = new Map<string, SessionEntry>();
	private _commonWatcher: FileWatcher | undefined;
	private _disposed = false;

	constructor(
		readonly commonGitDir: string,
		private readonly provider: FileWatchingProvider,
	) {}

	[Symbol.dispose](): void {
		this.dispose();
	}

	/** Dispose the entire group (common watcher + all root watchers). */
	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;

		for (const entry of this._sessions.values()) {
			entry.rootWatcher.dispose();
		}
		this._sessions.clear();

		this._commonWatcher?.dispose();
		this._commonWatcher = undefined;
	}

	get sessions(): ReadonlyMap<string, SessionEntry> {
		return this._sessions;
	}

	/** Add a session to this group. Creates the root watcher for the session's gitDir. */
	addSession(repoPath: string, gitDir: GitDir, hooks: WatchGroupHooks): void {
		if (this._disposed) return;
		if (this._sessions.has(repoPath)) return; // Already tracked

		// Determine the glob pattern for the root watcher
		const isStandard = gitDir.commonUri == null;
		const rootPattern = isStandard ? dotGitGlobCombined : dotGitGlobRoot;

		const rootWatcher = this.provider.createWatcher(gitDir.uri.fsPath, rootPattern, (event: FileWatchEvent) => {
			const entry = this._sessions.get(repoPath);
			if (entry != null) {
				this.onRootEvent(event, entry);
			}
		});

		const entry: SessionEntry = {
			repoPath: repoPath,
			gitDirPath: gitDir.uri.fsPath,
			rootWatcher: rootWatcher,
			hooks: hooks,
		};

		this._sessions.set(repoPath, entry);

		// Start the common watcher if this is a worktree repo and we haven't yet.
		// Standard repos don't need a separate common watcher because their root
		// watcher uses dotGitGlobCombined which already covers all patterns.
		if (!isStandard) {
			this.ensureCommonWatcher();
		}
	}

	/** Remove a session from this group. Disposes its root watcher. */
	removeSession(repoPath: string): void {
		const entry = this._sessions.get(repoPath);
		if (entry == null) return;

		entry.rootWatcher.dispose();
		this._sessions.delete(repoPath);

		// If no more sessions, dispose the common watcher
		if (this._sessions.size === 0 && this._commonWatcher != null) {
			this._commonWatcher.dispose();
			this._commonWatcher = undefined;
		}
	}

	private ensureCommonWatcher(): void {
		if (this._commonWatcher != null || this._disposed) return;

		this._commonWatcher = this.provider.createWatcher(
			this.commonGitDir,
			dotGitGlobCommon,
			(event: FileWatchEvent) => {
				this.onCommonEvent(event);
			},
		);
	}

	private onCommonEvent(event: FileWatchEvent): void {
		// Compute relative path from common git dir
		if (!isDescendant(event.path, this.commonGitDir)) return;
		const relativePath = relative(this.commonGitDir, event.path);
		if (shouldIgnoreRepoPath(relativePath)) return;

		// FETCH_HEAD lives in the main .git dir, not in worktree subdirs.
		// Dispatch to all sessions so each worktree can update its last-fetched state.
		if (relativePath === 'FETCH_HEAD') {
			for (const entry of this._sessions.values()) {
				entry.hooks.onFetchHeadChanged?.(entry.repoPath);
			}
			return;
		}

		const changes = classifyGitDirChange(relativePath);

		// Dispatch to ALL sessions in the group
		for (const entry of this._sessions.values()) {
			if (changes != null) {
				entry.hooks.onRepoChanged(entry.repoPath, changes);
			}

			// Check for special cases
			if (relativePath === 'info/exclude') {
				entry.hooks.onIgnoresChanged?.(entry.repoPath);
			}
		}
	}

	private onRootEvent(event: FileWatchEvent, entry: SessionEntry): void {
		if (!isDescendant(event.path, entry.gitDirPath)) return;
		const relativePath = relative(entry.gitDirPath, event.path);
		if (shouldIgnoreRepoPath(relativePath)) return;

		// Check for FETCH_HEAD before interpretation
		if (relativePath === 'FETCH_HEAD') {
			entry.hooks.onFetchHeadChanged?.(entry.repoPath);
			return;
		}

		const changes = classifyGitDirChange(relativePath);
		if (changes != null) {
			entry.hooks.onRepoChanged(entry.repoPath, changes);
		}

		if (relativePath === 'info/exclude') {
			entry.hooks.onIgnoresChanged?.(entry.repoPath);
		}
	}
}
