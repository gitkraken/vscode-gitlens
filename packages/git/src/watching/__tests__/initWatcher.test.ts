import assert from 'node:assert';
import { describe, it } from 'node:test';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import type { RepositoryInitEvent } from '../initWatcher.js';
import { RepositoryInitWatcher } from '../initWatcher.js';
import type { FileWatcher, FileWatchEvent, FileWatchingProvider } from '../provider.js';
import { gitInitGlob } from '../watcherPatterns.js';

interface MockWatcher extends FileWatcher {
	readonly basePath: string;
	readonly pattern: string;
	fire(event: FileWatchEvent): void;
	disposed: boolean;
}

function createMockFactory(): { factory: FileWatchingProvider; watchers: MockWatcher[] } {
	const watchers: MockWatcher[] = [];
	const factory: FileWatchingProvider = {
		createWatcher: function (
			basePath: string,
			pattern: string,
			onEvent: (event: FileWatchEvent) => void,
		): FileWatcher {
			const w: MockWatcher = mixinDisposable(
				{
					basePath: basePath,
					pattern: pattern,
					disposed: false,
					fire: function (event: FileWatchEvent): void {
						onEvent(event);
					},
				},
				() => (w.disposed = true),
			);
			watchers.push(w);
			return w;
		},
	};
	return { factory: factory, watchers: watchers };
}

describe('RepositoryInitWatcher', () => {
	describe('watch', () => {
		it('creates a watcher with the correct basePath and pattern', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			initWatcher.watch('/workspace');

			assert.strictEqual(watchers.length, 1);
			assert.strictEqual(watchers[0].basePath, '/workspace');
			assert.strictEqual(watchers[0].pattern, gitInitGlob);

			initWatcher.dispose();
		});

		it('does not create duplicate watchers for the same basePath', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			initWatcher.watch('/workspace');
			initWatcher.watch('/workspace');

			assert.strictEqual(watchers.length, 1);

			initWatcher.dispose();
		});

		it('creates separate watchers for different basePaths', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			initWatcher.watch('/workspace-a');
			initWatcher.watch('/workspace-b');

			assert.strictEqual(watchers.length, 2);
			assert.strictEqual(watchers[0].basePath, '/workspace-a');
			assert.strictEqual(watchers[1].basePath, '/workspace-b');

			initWatcher.dispose();
		});
	});

	describe('onDidCreate', () => {
		it('fires for create events only', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			initWatcher.watch('/workspace');

			const events: RepositoryInitEvent[] = [];
			initWatcher.onDidCreate(e => events.push(e));

			watchers[0].fire({ path: '/workspace/project/.git', reason: 'create' });
			watchers[0].fire({ path: '/workspace/project/.git', reason: 'change' });
			watchers[0].fire({ path: '/workspace/project/.git', reason: 'delete' });

			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].path, '/workspace/project/.git');

			initWatcher.dispose();
		});

		it('includes basePath in the event', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			initWatcher.watch('/workspace');

			const events: RepositoryInitEvent[] = [];
			initWatcher.onDidCreate(e => events.push(e));

			watchers[0].fire({ path: '/workspace/project/.git', reason: 'create' });

			assert.strictEqual(events[0].basePath, '/workspace');

			initWatcher.dispose();
		});

		it('fires events from multiple watched paths', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			initWatcher.watch('/workspace-a');
			initWatcher.watch('/workspace-b');

			const events: RepositoryInitEvent[] = [];
			initWatcher.onDidCreate(e => events.push(e));

			watchers[0].fire({ path: '/workspace-a/repo/.git', reason: 'create' });
			watchers[1].fire({ path: '/workspace-b/repo/.git', reason: 'create' });

			assert.strictEqual(events.length, 2);
			assert.strictEqual(events[0].basePath, '/workspace-a');
			assert.strictEqual(events[1].basePath, '/workspace-b');

			initWatcher.dispose();
		});
	});

	describe('dispose watch handle', () => {
		it('stops watching when the handle is disposed', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			const handle = initWatcher.watch('/workspace');

			assert.strictEqual(watchers[0].disposed, false);

			handle.dispose();

			assert.strictEqual(watchers[0].disposed, true);

			initWatcher.dispose();
		});

		it('does not fire events after handle is disposed', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			const handle = initWatcher.watch('/workspace');

			const events: RepositoryInitEvent[] = [];
			initWatcher.onDidCreate(e => events.push(e));

			watchers[0].fire({ path: '/workspace/a/.git', reason: 'create' });
			assert.strictEqual(events.length, 1);

			handle.dispose();

			// The underlying mock watcher is disposed, so it won't fire.
			// But even if it did, the watcher is removed from the map.
			assert.strictEqual(watchers[0].disposed, true);

			initWatcher.dispose();
		});

		it('is safe to dispose a handle multiple times', () => {
			const { factory } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			const handle = initWatcher.watch('/workspace');
			handle.dispose();
			handle.dispose(); // should not throw

			initWatcher.dispose();
		});
	});

	describe('dispose', () => {
		it('disposes all watchers', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			initWatcher.watch('/workspace-a');
			initWatcher.watch('/workspace-b');

			initWatcher.dispose();

			assert.strictEqual(watchers[0].disposed, true);
			assert.strictEqual(watchers[1].disposed, true);
		});

		it('watch() returns a no-op handle after dispose', () => {
			const { factory, watchers } = createMockFactory();
			const initWatcher = new RepositoryInitWatcher(factory);

			initWatcher.dispose();

			const handle = initWatcher.watch('/workspace');
			// Should not create a new watcher
			assert.strictEqual(watchers.length, 0);
			// Should not throw
			handle.dispose();
		});
	});
});
