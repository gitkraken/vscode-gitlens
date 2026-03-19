import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { GitDir } from '../../models/repository.js';
import type { FileWatcher, FileWatchEvent, FileWatchingProvider } from '../provider.js';
import { dotGitGlobCombined, dotGitGlobCommon, dotGitGlobRoot } from '../watcherPatterns.js';
import type { WatchGroupHooks } from '../watchGroup.js';
import { WatchGroup } from '../watchGroup.js';

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

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type MockFn = ReturnType<typeof mock.fn> & Function;

function callCount(fn: unknown): number {
	return (fn as MockFn).mock.callCount();
}

function callArgs(fn: unknown, index: number): unknown[] {
	return (fn as MockFn).mock.calls[index].arguments;
}

function makeCallbacks(overrides?: Partial<WatchGroupHooks>): WatchGroupHooks {
	return {
		onRepoChanged: overrides?.onRepoChanged ?? (mock.fn() as unknown as WatchGroupHooks['onRepoChanged']),
		onFetchHeadChanged: overrides?.onFetchHeadChanged,
		onIgnoresChanged: overrides?.onIgnoresChanged,
	};
}

function standardGitDir(path: string): GitDir {
	return { uri: fileUri(path) };
}

function worktreeGitDir(path: string, commonPath: string): GitDir {
	return { uri: fileUri(path), commonUri: fileUri(commonPath) };
}

describe('WatchGroup', () => {
	describe('constructor', () => {
		it('exposes commonGitDir', () => {
			const { factory } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			assert.strictEqual(group.commonGitDir, '/repo/.git');
		});

		it('starts with no sessions', () => {
			const { factory } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			assert.strictEqual(group.sessions.size, 0);
		});

		it('does not create any watchers until a session is added', () => {
			const { factory, watchers } = createMockFactory();
			new WatchGroup('/repo/.git', factory);
			assert.strictEqual(watchers.length, 0);
		});
	});

	describe('addSession — standard repo', () => {
		it('creates a root watcher with combined glob', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			group.addSession('/repo', gitDir, makeCallbacks());

			assert.strictEqual(watchers.length, 1);
			assert.strictEqual(watchers[0].basePath, '/repo/.git');
			assert.strictEqual(watchers[0].pattern, dotGitGlobCombined);
		});

		it('does NOT create a common watcher for standard repos', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			group.addSession('/repo', gitDir, makeCallbacks());

			// Only the root watcher, no common watcher
			assert.strictEqual(watchers.length, 1);
		});

		it('adds the session to the sessions map', () => {
			const { factory } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			group.addSession('/repo', gitDir, makeCallbacks());

			assert.strictEqual(group.sessions.size, 1);
			assert.ok(group.sessions.has('/repo'));
		});

		it('ignores duplicate addSession for same repoPath', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			group.addSession('/repo', gitDir, makeCallbacks());
			group.addSession('/repo', gitDir, makeCallbacks());

			assert.strictEqual(watchers.length, 1);
			assert.strictEqual(group.sessions.size, 1);
		});
	});

	describe('addSession — worktree repo', () => {
		it('creates a root watcher with root-only glob', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');

			group.addSession('/worktrees/A', gitDir, makeCallbacks());

			// Root watcher + common watcher
			assert.strictEqual(watchers.length, 2);
			const rootWatcher = watchers.find(w => w.basePath === '/repo/.git/worktrees/A');
			assert.ok(rootWatcher);
			assert.strictEqual(rootWatcher.pattern, dotGitGlobRoot);
		});

		it('creates a common watcher for worktree repos', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');

			group.addSession('/worktrees/A', gitDir, makeCallbacks());

			const commonWatcher = watchers.find(w => w.basePath === '/repo/.git' && w.pattern === dotGitGlobCommon);
			assert.ok(commonWatcher);
		});

		it('shares the common watcher across multiple worktree sessions', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDirA = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');
			const gitDirB = worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git');

			group.addSession('/worktrees/A', gitDirA, makeCallbacks());
			group.addSession('/worktrees/B', gitDirB, makeCallbacks());

			// 2 root watchers + 1 common watcher = 3 total
			assert.strictEqual(watchers.length, 3);
			const commonWatchers = watchers.filter(w => w.pattern === dotGitGlobCommon);
			assert.strictEqual(commonWatchers.length, 1);
		});
	});

	describe('event routing — root watcher', () => {
		it('dispatches interpreted changes to the owning session only', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDirA = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');
			const gitDirB = worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git');

			const callbacksA = makeCallbacks();
			const callbacksB = makeCallbacks();
			group.addSession('/worktrees/A', gitDirA, callbacksA);
			group.addSession('/worktrees/B', gitDirB, callbacksB);

			// Find the root watcher for worktree A
			const rootA = watchers.find(w => w.basePath === '/repo/.git/worktrees/A');
			assert.ok(rootA);

			// Fire a HEAD change event on worktree A's root watcher
			rootA.fire({ path: '/repo/.git/worktrees/A/HEAD', reason: 'change' });

			assert.strictEqual(callCount(callbacksA.onRepoChanged), 1);
			assert.strictEqual(callCount(callbacksB.onRepoChanged), 0);
		});

		it('dispatches FETCH_HEAD to onFetchHeadChanged callback', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			const onFetchHeadChanged = mock.fn();
			const onRepoChanged = mock.fn();
			group.addSession(
				'/repo',
				gitDir,
				makeCallbacks({ onRepoChanged: onRepoChanged, onFetchHeadChanged: onFetchHeadChanged }),
			);

			const rootWatcher = watchers[0];
			rootWatcher.fire({ path: '/repo/.git/FETCH_HEAD', reason: 'change' });

			assert.strictEqual(onFetchHeadChanged.mock.callCount(), 1);
			assert.strictEqual(onFetchHeadChanged.mock.calls[0].arguments[0], '/repo');
			// FETCH_HEAD should NOT trigger onRepoChanged
			assert.strictEqual(onRepoChanged.mock.callCount(), 0);
		});

		it('filters out noise (index.lock)', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			const onRepoChanged = mock.fn();
			group.addSession('/repo', gitDir, makeCallbacks({ onRepoChanged: onRepoChanged }));

			watchers[0].fire({ path: '/repo/.git/index.lock', reason: 'change' });

			assert.strictEqual(onRepoChanged.mock.callCount(), 0);
		});

		it('filters out noise (fsmonitor--daemon)', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			const onRepoChanged = mock.fn();
			group.addSession('/repo', gitDir, makeCallbacks({ onRepoChanged: onRepoChanged }));

			watchers[0].fire({ path: '/repo/.git/fsmonitor--daemon/cookie', reason: 'change' });

			assert.strictEqual(onRepoChanged.mock.callCount(), 0);
		});

		it('ignores events with paths outside the git dir', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			const onRepoChanged = mock.fn();
			group.addSession('/repo', gitDir, makeCallbacks({ onRepoChanged: onRepoChanged }));

			watchers[0].fire({ path: '/other-repo/.git/HEAD', reason: 'change' });

			assert.strictEqual(onRepoChanged.mock.callCount(), 0);
		});
	});

	describe('event routing — common watcher', () => {
		it('dispatches common events to ALL sessions in the group', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDirA = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');
			const gitDirB = worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git');

			const callbacksA = makeCallbacks();
			const callbacksB = makeCallbacks();
			group.addSession('/worktrees/A', gitDirA, callbacksA);
			group.addSession('/worktrees/B', gitDirB, callbacksB);

			// Find the common watcher
			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);

			// Fire a refs/heads/main change (common event)
			common.fire({ path: '/repo/.git/refs/heads/main', reason: 'change' });

			assert.strictEqual(callCount(callbacksA.onRepoChanged), 1);
			assert.strictEqual(callCount(callbacksB.onRepoChanged), 1);
		});

		it('dispatches info/exclude to onIgnoresChanged for all sessions', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDirA = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');
			const gitDirB = worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git');

			const onIgnoresA = mock.fn();
			const onIgnoresB = mock.fn();
			const callbacksA = makeCallbacks({ onIgnoresChanged: onIgnoresA });
			const callbacksB = makeCallbacks({ onIgnoresChanged: onIgnoresB });
			group.addSession('/worktrees/A', gitDirA, callbacksA);
			group.addSession('/worktrees/B', gitDirB, callbacksB);

			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);

			common.fire({ path: '/repo/.git/info/exclude', reason: 'change' });

			assert.strictEqual(onIgnoresA.mock.callCount(), 1);
			assert.strictEqual(onIgnoresB.mock.callCount(), 1);
		});

		it('filters out noise from common watcher events', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');

			const onRepoChanged = mock.fn();
			group.addSession('/worktrees/A', gitDir, makeCallbacks({ onRepoChanged: onRepoChanged }));

			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);

			common.fire({ path: '/repo/.git/index.lock', reason: 'change' });

			assert.strictEqual(onRepoChanged.mock.callCount(), 0);
		});
	});

	describe('event routing — change interpretation', () => {
		it('interprets HEAD changes correctly', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			const onRepoChanged = mock.fn();
			group.addSession('/repo', gitDir, makeCallbacks({ onRepoChanged: onRepoChanged }));

			watchers[0].fire({ path: '/repo/.git/HEAD', reason: 'change' });

			assert.strictEqual(onRepoChanged.mock.callCount(), 1);
			const [repoPath, changes] = onRepoChanged.mock.calls[0].arguments;
			assert.strictEqual(repoPath, '/repo');
			// HEAD → [Head, Heads]
			assert.ok(changes.length >= 1);
		});

		it('interprets config changes correctly via common watcher', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');

			const onRepoChanged = mock.fn();
			group.addSession('/worktrees/A', gitDir, makeCallbacks({ onRepoChanged: onRepoChanged }));

			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);

			common.fire({ path: '/repo/.git/config', reason: 'change' });

			assert.strictEqual(onRepoChanged.mock.callCount(), 1);
			const [repoPath] = onRepoChanged.mock.calls[0].arguments;
			assert.strictEqual(repoPath, '/worktrees/A');
		});

		it('drops unrecognized paths (no callback)', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			const onRepoChanged = mock.fn();
			group.addSession('/repo', gitDir, makeCallbacks({ onRepoChanged: onRepoChanged }));

			watchers[0].fire({ path: '/repo/.git/objects/pack/something', reason: 'change' });

			assert.strictEqual(onRepoChanged.mock.callCount(), 0);
		});
	});

	describe('removeSession', () => {
		it('removes the session and disposes its root watcher', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			group.addSession('/repo', gitDir, makeCallbacks());
			assert.strictEqual(group.sessions.size, 1);

			group.removeSession('/repo');
			assert.strictEqual(group.sessions.size, 0);
			assert.ok(watchers[0].disposed);
		});

		it('disposes common watcher when last session is removed', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDirA = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');
			const gitDirB = worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git');

			group.addSession('/worktrees/A', gitDirA, makeCallbacks());
			group.addSession('/worktrees/B', gitDirB, makeCallbacks());

			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);
			assert.ok(!common.disposed);

			// Remove first session — common watcher should still be alive
			group.removeSession('/worktrees/A');
			assert.ok(!common.disposed);
			assert.strictEqual(group.sessions.size, 1);

			// Remove last session — common watcher should be disposed
			group.removeSession('/worktrees/B');
			assert.ok(common.disposed);
			assert.strictEqual(group.sessions.size, 0);
		});

		it('is a no-op for unknown repoPath', () => {
			const { factory } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);

			// Should not throw
			group.removeSession('/nonexistent');
		});

		it('stops dispatching events after removal', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDirA = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');
			const gitDirB = worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git');

			const callbacksA = makeCallbacks();
			const callbacksB = makeCallbacks();
			group.addSession('/worktrees/A', gitDirA, callbacksA);
			group.addSession('/worktrees/B', gitDirB, callbacksB);

			// Remove session A
			group.removeSession('/worktrees/A');

			// Fire common event — should only reach B now
			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);
			common.fire({ path: '/repo/.git/refs/heads/main', reason: 'change' });

			assert.strictEqual(callCount(callbacksA.onRepoChanged), 0);
			assert.strictEqual(callCount(callbacksB.onRepoChanged), 1);
		});
	});

	describe('dispose', () => {
		it('disposes all root watchers and common watcher', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDirA = worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git');
			const gitDirB = worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git');

			group.addSession('/worktrees/A', gitDirA, makeCallbacks());
			group.addSession('/worktrees/B', gitDirB, makeCallbacks());

			assert.strictEqual(watchers.length, 3); // 2 root + 1 common

			group.dispose();

			for (const w of watchers) {
				assert.ok(w.disposed, `Watcher for ${w.basePath} (${w.pattern}) should be disposed`);
			}
			assert.strictEqual(group.sessions.size, 0);
		});

		it('is idempotent', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			group.addSession('/repo', gitDir, makeCallbacks());

			group.dispose();
			group.dispose(); // Should not throw

			assert.strictEqual(watchers.length, 1);
			assert.ok(watchers[0].disposed);
		});

		it('prevents addSession after dispose', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const gitDir = standardGitDir('/repo/.git');

			group.dispose();
			group.addSession('/repo', gitDir, makeCallbacks());

			assert.strictEqual(group.sessions.size, 0);
			assert.strictEqual(watchers.length, 0);
		});
	});

	describe('Windows path handling', () => {
		it('normalizes backslashes in event paths', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('C:/repo/.git', factory);
			const gitDir = standardGitDir('C:/repo/.git');

			const onRepoChanged = mock.fn();
			group.addSession('C:/repo', gitDir, makeCallbacks({ onRepoChanged: onRepoChanged }));

			// Simulate a Windows event with backslashes.
			// Use lowercase 'c:' to match URI.file().fsPath normalization
			// (vscode-uri lowercases drive letters on all platforms).
			watchers[0].fire({ path: 'c:\\repo\\.git\\HEAD', reason: 'change' });

			assert.strictEqual(onRepoChanged.mock.callCount(), 1);
		});
	});
});
