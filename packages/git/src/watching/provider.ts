import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';

/** Event from a filesystem watcher */
export interface FileWatchEvent {
	/** Absolute path of the changed file */
	readonly path: string;
	readonly reason: 'create' | 'change' | 'delete';
}

/** Opaque token representing a filesystem watcher */
export interface FileWatcher extends UnifiedDisposable {}

/**
 * Factory for creating filesystem watchers. The library calls this
 * with a base path + glob pattern; the caller creates platform-specific
 * watchers (e.g., VS Code's `workspace.createFileSystemWatcher`).
 *
 * This is the only pluggable concern in the watching system.
 * Everything else (interpretation, gitignore, debouncing, etc.)
 * is fully library-owned.
 */
export interface FileWatchingProvider {
	createWatcher(basePath: string, pattern: string, onEvent: (event: FileWatchEvent) => void): FileWatcher;
}
