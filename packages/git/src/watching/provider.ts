import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';

/** Event from a filesystem watcher */
export interface FileWatchEvent {
	/** Absolute path of the changed file */
	readonly path: string;
	readonly reason: 'create' | 'change' | 'delete';
}

/** Opaque token representing a filesystem watcher */
export interface FileWatcher extends UnifiedDisposable {}

export interface FileWatcherOptions {
	/**
	 * Directories to leave unwatched, each with everything beneath it. Entries are `/`-separated and relative to
	 * `basePath`: a glob when it contains glob syntax (`build-*`), otherwise a literal path (`dist`,
	 * `packages/app/out`) — core never emits a literal containing glob metacharacters. A provider that can prune
	 * natively should (no OS watch, no events); one that can't may ignore this, since core filters events itself.
	 * (Map each entry to your backend's syntax — e.g. picomatch-based watchers need both `X` and `X/**`.)
	 */
	readonly excludes?: readonly string[];
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
