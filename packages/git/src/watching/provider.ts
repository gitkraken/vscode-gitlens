import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';

/**
 * Event from a filesystem watcher.
 *
 * A reported directory path stands for everything beneath it: a watcher can miss the files of a just-created
 * directory (it only sees the directory after its create event), but never the directory itself.
 */
export interface FileWatchEvent {
	/** Absolute path of the changed file or directory; for `overflow`, the watcher's `basePath` or a subtree of it */
	readonly path: string;
	/**
	 * `overflow`: events under `path` (the watcher's `basePath`, or a subtree of it) were dropped, so core rescans
	 * rather than trusting what it was told. Providers that can't lose events never emit it.
	 */
	readonly reason: 'create' | 'change' | 'delete' | 'overflow';
}

/** Opaque token representing a filesystem watcher */
export interface FileWatcher extends UnifiedDisposable {}

/**
 * How much of what changes under a watcher's `basePath` it reports:
 * - `reliable`: everything (the state of a watcher that never reports one);
 * - `unreliable`: what changes on this machine, but maybe not another's edits (a network volume), so core polls
 *   beside it;
 * - `unwatchable`: nothing (a filesystem without change notifications, or a watch that went down), so core polls
 *   instead.
 */
export type FileWatcherReliability = 'reliable' | 'unreliable' | 'unwatchable';

export interface FileWatcherOptions {
	/**
	 * Directories to leave unwatched, each with everything beneath it. Entries are `/`-separated and relative to
	 * `basePath`: a glob when it contains glob syntax (`build-*`), otherwise a literal path (`dist`,
	 * `packages/app/out`) — core never emits a literal containing glob metacharacters. A provider that can prune
	 * natively should (no OS watch, no events); one that can't may ignore this, since core filters events itself.
	 * (Map each entry to your backend's syntax — e.g. picomatch-based watchers need both `X` and `X/**`.)
	 */
	readonly excludes?: readonly string[];
	/**
	 * Reports this watcher's {@link FileWatcherReliability} whenever it changes; passed only when the host opted into
	 * polling (`WatchServiceOptions.polling`). May be called synchronously inside `createWatcher`, and again later
	 * (a watch going down, or coming back). Each watcher reports its own state, so one created on a path that is
	 * already down reports `unwatchable` itself. Going from `unwatchable` to anything else makes core rescan.
	 */
	readonly onDidChangeReliability?: (state: FileWatcherReliability) => void;
}

/**
 * Factory for creating filesystem watchers. The library calls this
 * with a base path + glob pattern (plus, optionally, directories to prune);
 * the caller creates platform-specific watchers (e.g., VS Code's
 * `workspace.createFileSystemWatcher`, or a native watcher such as `@parcel/watcher`).
 *
 * This is the only pluggable concern in the watching system.
 * Everything else (interpretation, gitignore, debouncing, which directories
 * to exclude, etc.) is fully library-owned.
 */
export interface FileWatchingProvider {
	createWatcher(
		basePath: string,
		pattern: string,
		onEvent: (event: FileWatchEvent) => void,
		options?: FileWatcherOptions,
	): FileWatcher;
	/**
	 * True when `createWatcher` prunes `options.excludes` natively. Core only spends git reads on the git-ignored
	 * set for a provider that can use it.
	 */
	readonly supportsExcludes?: boolean;
}
