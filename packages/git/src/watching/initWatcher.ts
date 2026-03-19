import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { FileWatcher, FileWatchingProvider } from './provider.js';
import { gitInitGlob } from './watcherPatterns.js';

export interface RepositoryInitEvent {
	/** Absolute path of the created .git directory */
	readonly path: string;
	/** Absolute path of the base directory being watched */
	readonly basePath: string;
}

/**
 * Watches for `.git` directory creation within watched base paths.
 * Used to discover new repositories when `git init` or `git clone` runs.
 *
 * This is separate from {@link RepositoryWatchService} which monitors
 * already-discovered repositories. The init watcher is a pre-discovery
 * concern — it fires before a repository is known.
 */
export class RepositoryInitWatcher implements UnifiedDisposable {
	private readonly provider: FileWatchingProvider;
	private readonly emitter = new Emitter<RepositoryInitEvent>();
	private readonly watchers = new Map<string, FileWatcher>();
	private _disposed = false;

	constructor(provider: FileWatchingProvider) {
		this.provider = provider;
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;

		for (const watcher of this.watchers.values()) {
			watcher.dispose();
		}
		this.watchers.clear();
		this.emitter.dispose();
	}

	get onDidCreate(): Event<RepositoryInitEvent> {
		return this.emitter.event;
	}

	/**
	 * Start watching a directory for `.git` creation.
	 * Returns a disposable that stops watching that directory.
	 */
	watch(basePath: string): UnifiedDisposable {
		if (this._disposed || this.watchers.has(basePath)) {
			return createDisposable(() => {});
		}

		const watcher = this.provider.createWatcher(basePath, gitInitGlob, event => {
			if (event.reason !== 'create') return;
			this.emitter.fire({ path: event.path, basePath: basePath });
		});

		this.watchers.set(basePath, watcher);

		return createDisposable(
			() => {
				const w = this.watchers.get(basePath);
				if (w === watcher) {
					this.watchers.delete(basePath);
					w.dispose();
				}
			},
			{ once: true },
		);
	}
}
