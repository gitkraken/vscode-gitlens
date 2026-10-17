import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { some } from '@gitlens/utils/iterable.js';
import { isDescendant, relative } from '@gitlens/utils/path.js';
import type { GitDir, RepositoryChange } from '../models/repository.js';
import { allWatchedRepositoryChanges, classifyGitDirChange } from './classifyChange.js';
import type { GitDirPoller, GitDirProbe } from './gitDirPoller.js';
import { GitDirProbeTarget } from './gitDirPoller.js';
import type {
	FileWatcher,
	FileWatcherOptions,
	FileWatcherReliability,
	FileWatchEvent,
	FileWatchingProvider,
} from './provider.js';
import {
	dotGitGlobCombined,
	dotGitGlobCommon,
	dotGitGlobRoot,
	getGitDirRefProbes,
	gitDirCommonProbes,
	gitDirExcludes,
	gitDirProbesByEmittedPath,
	gitDirRootProbes,
	shouldIgnoreRepoPath,
} from './watcherPatterns.js';

/**
 * Hooks that the WatchGroup fires when events are interpreted.
 * These are raw, un-debounced events — the session handles debouncing.
 */
export interface WatchGroupHooks {
	/**
	 * `ref` is the full ref name (or ref directory) or pseudo-ref (`HEAD`, `ORIG_HEAD`) whose file changed, with a
	 * trailing `.lock` stripped; `undefined` for any other `.git` file. `overflow` marks the every-kind rescan of a
	 * watcher that dropped events, which no single write can account for.
	 */
	readonly onRepoChanged: (repoPath: string, changes: RepositoryChange[], ref?: string, overflow?: boolean) => void;
	readonly onFetchHeadChanged?: (repoPath: string) => void;
	readonly onIgnoresChanged?: (repoPath: string) => void;
	/** The refs whose loose files a poll stats for this session, read at each poll */
	readonly getProbeRefs?: () => Iterable<string>;
	/** A watcher this session hears through went `unwatchable`, or stopped being it (see {@link WatchGroup.isUnwatchable}) */
	readonly onUnwatchableChanged?: (repoPath: string) => void;
}

/**
 * Tracks one session's connection to a WatchGroup.
 * Each session has its own root watcher but shares the common watcher.
 */
interface SessionEntry {
	readonly repoPath: string;
	readonly gitDirPath: string;
	readonly rootWatcher: FileWatcher;
	/** True when the root watcher is on the common dir itself, so it already sees every common file */
	readonly coversCommon: boolean;
	/** For a linked session, its `<n>` in `<common>/worktrees/<n>`; otherwise `undefined` */
	readonly worktreeId: string | undefined;
	readonly hooks: WatchGroupHooks;
	reliability: FileWatcherReliability;
	/** Polls in place of (or beside) the root watcher while it isn't `reliable` */
	target?: GitDirProbeTarget;
}

/**
 * Manages filesystem watchers for a single physical `.git` directory,
 * shared across all worktrees that reference it.
 *
 * Structure:
 * - 1 common watcher: config, refs/**, info/exclude, etc. Delivers to linked sessions only; a
 *   session rooted at the common dir hears the same files from its own combined root watcher.
 * - N root watchers: one per worktree (index, HEAD, *_HEAD, etc.)
 *
 * For a standard (non-worktree) repo, the common and root directories
 * are the same, but we still create separate watchers for clean separation.
 */
export class WatchGroup implements UnifiedDisposable {
	private readonly _sessions = new Map<string, SessionEntry>();
	private _commonWatcher: FileWatcher | undefined;
	private _commonReliability: FileWatcherReliability = 'reliable';
	private _commonTarget: GitDirProbeTarget | undefined;
	private _disposed = false;

	constructor(
		readonly commonGitDir: string,
		private readonly provider: FileWatchingProvider,
		/** When given, a watcher that reports it can't be trusted is polled; otherwise none is asked */
		private readonly poller?: GitDirPoller,
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
			this.stopPolling(entry);
		}
		this._sessions.clear();

		this.disposeCommonWatcher();
	}

	get sessions(): ReadonlyMap<string, SessionEntry> {
		return this._sessions;
	}

	/** True when a watcher the session hears through — its root watcher, or a linked session's common one — can't watch */
	isUnwatchable(repoPath: string): boolean {
		const entry = this._sessions.get(repoPath);
		if (entry == null) return false;

		return (
			entry.reliability === 'unwatchable' || (!entry.coversCommon && this._commonReliability === 'unwatchable')
		);
	}

	/** Add a session to this group. Creates the root watcher for the session's gitDir. */
	addSession(repoPath: string, gitDir: GitDir, hooks: WatchGroupHooks): void {
		if (this._disposed) return;
		if (this._sessions.has(repoPath)) return; // Already tracked

		// Determine the glob pattern for the root watcher
		const isStandard = gitDir.commonUri == null;
		const rootPattern = isStandard ? dotGitGlobCombined : dotGitGlobRoot;

		// The watcher can report its reliability before `createWatcher` returns, so before the entry exists
		let entry: SessionEntry | undefined;
		let initialReliability: FileWatcherReliability = 'reliable';

		const rootWatcher = this.provider.createWatcher(
			gitDir.uri.fsPath,
			rootPattern,
			(event: FileWatchEvent) => {
				const e = this._sessions.get(repoPath);
				if (e != null) {
					if (event.reason !== 'overflow') {
						e.target?.forget(event.path);
					}
					this.onRootEvent(event, e);
				}
			},
			this.getWatcherOptions(state => {
				if (entry == null) {
					initialReliability = state;
				} else if (this._sessions.get(repoPath) === entry) {
					this.setRootReliability(entry, state);
				}
			}),
		);

		const entryGitDirPath = gitDir.uri.fsPath;
		entry = {
			repoPath: repoPath,
			gitDirPath: entryGitDirPath,
			rootWatcher: rootWatcher,
			coversCommon: isStandard,
			worktreeId: isStandard ? undefined : this.getWorktreeId(entryGitDirPath),
			hooks: hooks,
			reliability: 'reliable',
		};

		this._sessions.set(repoPath, entry);
		if (initialReliability !== 'reliable') {
			this.setRootReliability(entry, initialReliability, true);
		}

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
		this.stopPolling(entry);
		this._sessions.delete(repoPath);

		// Once no linked session is left, dispose the common watcher — it delivers to linked sessions only
		if (this._commonWatcher != null && !some(this._sessions.values(), e => !e.coversCommon)) {
			this.disposeCommonWatcher();
		}
	}

	private getWorktreeId(gitDirPath: string): string | undefined {
		if (!isDescendant(gitDirPath, this.commonGitDir)) return undefined;

		const rel = relative(this.commonGitDir, gitDirPath);
		if (!rel.startsWith('worktrees/')) return undefined;

		const id = rel.substring(10);
		return id.length > 0 && !id.includes('/') ? id : undefined;
	}

	private ensureCommonWatcher(): void {
		if (this._commonWatcher != null || this._disposed) return;

		// The watcher can report its reliability before `createWatcher` returns
		let watcher: FileWatcher | undefined;
		let initialReliability: FileWatcherReliability = 'reliable';
		const options = this.getWatcherOptions(state => {
			if (watcher == null) {
				initialReliability = state;
			} else if (this._commonWatcher === watcher) {
				this.setCommonReliability(state);
			}
		});

		watcher = this.provider.createWatcher(
			this.commonGitDir,
			dotGitGlobCommon,
			(event: FileWatchEvent) => {
				if (event.reason !== 'overflow') {
					this._commonTarget?.forget(event.path);
				}
				this.onCommonEvent(event);
			},
			options,
		);
		this._commonWatcher = watcher;
		if (initialReliability !== 'reliable') {
			this.setCommonReliability(initialReliability, true);
		}
	}

	private disposeCommonWatcher(): void {
		this._commonWatcher?.dispose();
		this._commonWatcher = undefined;
		this._commonReliability = 'reliable';
		if (this._commonTarget != null) {
			this.poller?.delete(this._commonTarget);
			this._commonTarget = undefined;
		}
	}

	/** Hosts that didn't opt into polling get exactly the options they always had */
	private getWatcherOptions(onDidChangeReliability: (state: FileWatcherReliability) => void): FileWatcherOptions {
		return this.poller != null
			? { excludes: gitDirExcludes, onDidChangeReliability: onDidChangeReliability }
			: { excludes: gitDirExcludes };
	}

	private setRootReliability(entry: SessionEntry, state: FileWatcherReliability, initial?: boolean): void {
		const previous = entry.reliability;
		if (previous === state || this.poller == null) return;

		entry.reliability = state;
		if (state === 'reliable') {
			this.stopPolling(entry);
		} else if (entry.target == null) {
			const target = new GitDirProbeTarget(
				entry.gitDirPath,
				this.poller,
				() => this.getRootProbes(entry),
				gitDirProbesByEmittedPath,
				(event, probe) => {
					if (entry.target !== target) return;

					this.onRootEvent(event, entry);
					if (probe.path === 'logs/HEAD' && !entry.coversCommon) {
						this.onLinkedHeadMoved();
					}
				},
			);
			entry.target = target;
			this.poller.add(target);
		}

		if ((state === 'unwatchable') === (previous === 'unwatchable')) return;

		// The watch went down or came back: whatever changed meanwhile went unseen
		if (!initial) {
			this.deliverOverflow(entry);
		}
		entry.hooks.onUnwatchableChanged?.(entry.repoPath);
	}

	private setCommonReliability(state: FileWatcherReliability, initial?: boolean): void {
		const previous = this._commonReliability;
		if (previous === state || this.poller == null) return;

		this._commonReliability = state;
		if (state === 'reliable') {
			if (this._commonTarget != null) {
				this.poller.delete(this._commonTarget);
				this._commonTarget = undefined;
			}
		} else if (this._commonTarget == null) {
			const target = new GitDirProbeTarget(
				this.commonGitDir,
				this.poller,
				() => this.getCommonProbes(),
				gitDirProbesByEmittedPath,
				event => {
					if (this._commonTarget === target) {
						this.onCommonEvent(event);
					}
				},
			);
			this._commonTarget = target;
			this.poller.add(target);
		}

		if ((state === 'unwatchable') === (previous === 'unwatchable')) return;

		for (const entry of this._sessions.values()) {
			if (entry.coversCommon) continue;

			if (!initial) {
				this.deliverOverflow(entry);
			}
			entry.hooks.onUnwatchableChanged?.(entry.repoPath);
		}
	}

	private stopPolling(entry: SessionEntry): void {
		if (entry.target == null) return;

		this.poller?.delete(entry.target);
		entry.target = undefined;
	}

	/**
	 * A session rooted at the common dir polls the common files too, with the refs of every session in the group: its
	 * combined watcher would hear them all. While the common dir is polled too, the poller stats each shared file once
	 * for both, and each keeps its own readings, so what one watcher reported is held back from its own sessions only
	 */
	private getRootProbes(entry: SessionEntry): readonly GitDirProbe[] {
		if (!entry.coversCommon) return gitDirRootProbes;

		const refs = new Set<string>();
		for (const e of this._sessions.values()) {
			for (const ref of e.hooks.getProbeRefs?.() ?? []) {
				refs.add(ref);
			}
		}
		return [...gitDirRootProbes, ...gitDirCommonProbes, ...getGitDirRefProbes(refs)];
	}

	/**
	 * A linked worktree's `logs/HEAD` moved — a commit or reset there, on a branch a polled session rooted at the common
	 * dir may not probe — so each such session hears a `heads` change its combined watcher would have heard
	 */
	private onLinkedHeadMoved(): void {
		for (const entry of this._sessions.values()) {
			if (!entry.coversCommon || entry.target == null) continue;

			entry.hooks.onRepoChanged(entry.repoPath, ['heads']);
		}
	}

	/** The common files, with the refs of every linked session (the only ones the common watcher delivers to) */
	private getCommonProbes(): GitDirProbe[] {
		const refs = new Set<string>();
		for (const entry of this._sessions.values()) {
			if (entry.coversCommon) continue;

			for (const ref of entry.hooks.getProbeRefs?.() ?? []) {
				refs.add(ref);
			}
		}
		return [...gitDirCommonProbes, ...getGitDirRefProbes(refs)];
	}

	private onCommonEvent(event: FileWatchEvent): void {
		if (event.reason === 'overflow') {
			for (const entry of this._sessions.values()) {
				if (entry.coversCommon) continue;

				this.deliverOverflow(entry);
			}
			return;
		}

		// Compute relative path from common git dir
		if (!isDescendant(event.path, this.commonGitDir)) return;

		const relativePath = relative(this.commonGitDir, event.path);
		if (shouldIgnoreRepoPath(relativePath)) return;

		const isFetchHead = relativePath === 'FETCH_HEAD';
		const isExclude = relativePath === 'info/exclude';
		const changes = isFetchHead ? undefined : classifyGitDirChange(relativePath);
		if (changes == null && !isFetchHead && !isExclude) return;

		const ref = changes != null ? getChangedRef(relativePath) : undefined;

		// `worktrees/<n>/HEAD`: the owner hears its own HEAD from its root watcher. Its `locked` and `gitdir` aren't in
		// the root glob, so the owner hears those only from here
		let ownerId: string | undefined;
		if (changes != null && relativePath.length > 10 && relativePath.startsWith('worktrees/')) {
			const idEnd = relativePath.indexOf('/', 10);
			if (idEnd !== -1 && relativePath.substring(idEnd + 1) === 'HEAD') {
				ownerId = relativePath.substring(10, idEnd);
			}
		}

		for (const entry of this._sessions.values()) {
			// A session rooted at the common dir sees every common file (hooks included) through its own
			// combined root watcher, so delivering here too would duplicate it
			if (entry.coversCommon) continue;

			if (isFetchHead) {
				// FETCH_HEAD lives in the main .git dir; each worktree updates its last-fetched state
				entry.hooks.onFetchHeadChanged?.(entry.repoPath);
				continue;
			}

			if (changes != null && (ownerId == null || entry.worktreeId !== ownerId)) {
				entry.hooks.onRepoChanged(entry.repoPath, changes, ref);
			}

			if (isExclude) {
				entry.hooks.onIgnoresChanged?.(entry.repoPath);
			}
		}
	}

	private deliverOverflow(entry: SessionEntry): void {
		// Every kind, no ref (ref kinds stay unnamed). Never `'unknown'` — the cache would unregister the path
		entry.hooks.onRepoChanged(entry.repoPath, [...allWatchedRepositoryChanges], undefined, true);
		entry.hooks.onFetchHeadChanged?.(entry.repoPath);
		entry.hooks.onIgnoresChanged?.(entry.repoPath);
	}

	private onRootEvent(event: FileWatchEvent, entry: SessionEntry): void {
		if (event.reason === 'overflow') {
			this.deliverOverflow(entry);
			return;
		}

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
			entry.hooks.onRepoChanged(entry.repoPath, changes, getChangedRef(relativePath));
		}

		if (relativePath === 'info/exclude') {
			entry.hooks.onIgnoresChanged?.(entry.repoPath);
		}
	}
}

/**
 * The ref a `.git`-relative path names: a loose ref (or ref directory) under `refs/`, or the `HEAD`/`ORIG_HEAD`
 * pseudo-refs. Git writes a ref as `<name>.lock` and renames it over `<name>`, so the lock file names the same ref.
 */
function getChangedRef(relativePath: string): string | undefined {
	const ref = relativePath.endsWith('.lock') ? relativePath.substring(0, relativePath.length - 5) : relativePath;
	return ref.startsWith('refs/') || ref === 'HEAD' || ref === 'ORIG_HEAD' ? ref : undefined;
}
