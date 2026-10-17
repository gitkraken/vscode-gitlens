import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { Cache } from '../../cache.js';
import type { GitDir } from '../../models/repository.js';
import { allWatchedRepositoryChanges } from '../classifyChange.js';
import { GitDirPoller } from '../gitDirPoller.js';
import type {
	FileWatcher,
	FileWatcherOptions,
	FileWatcherReliability,
	FileWatchEvent,
	FileWatchingProvider,
} from '../provider.js';
import {
	dotGitGlobCombined,
	dotGitGlobCommon,
	dotGitGlobRoot,
	gitDirCommonProbes,
	gitDirExcludes,
} from '../watcherPatterns.js';
import type { WatchGroupHooks } from '../watchGroup.js';
import { WatchGroup } from '../watchGroup.js';

interface MockWatcher extends FileWatcher {
	readonly basePath: string;
	readonly pattern: string;
	readonly options: FileWatcherOptions | undefined;
	fire(event: FileWatchEvent): void;
	/** Reports a reliability the way a provider would, after `createWatcher` returned */
	report(state: FileWatcherReliability): void;
	disposed: boolean;
}

/** `initialReliability` is reported synchronously inside `createWatcher`, for the watchers it returns one for */
function createMockFactory(initialReliability?: (basePath: string) => FileWatcherReliability | undefined): {
	factory: FileWatchingProvider;
	watchers: MockWatcher[];
} {
	const watchers: MockWatcher[] = [];
	const factory: FileWatchingProvider = {
		createWatcher: function (
			basePath: string,
			pattern: string,
			onEvent: (event: FileWatchEvent) => void,
			options?: FileWatcherOptions,
		): FileWatcher {
			const w: MockWatcher = mixinDisposable(
				{
					// Watchers get the git dir's OS path (`fsPath`), which is backslashed on Windows; normalize it so
					// the assertions can name the POSIX paths the fixtures are written in.
					basePath: normalizePath(basePath),
					pattern: pattern,
					options: options,
					disposed: false,
					fire: function (event: FileWatchEvent): void {
						onEvent(event);
					},
					report: function (state: FileWatcherReliability): void {
						options?.onDidChangeReliability?.(state);
					},
				},
				() => (w.disposed = true),
			);
			watchers.push(w);
			const initial = initialReliability?.(w.basePath);
			if (initial != null) {
				options?.onDidChangeReliability?.(initial);
			}
			return w;
		},
	};
	return { factory: factory, watchers: watchers };
}

// oxlint-disable-next-line typescript/no-unsafe-function-type
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

	describe('excludes', () => {
		it('passes the .git excludes to the root watcher of a standard repo', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);

			group.addSession('/repo', standardGitDir('/repo/.git'), makeCallbacks());

			assert.strictEqual(watchers.length, 1);
			assert.deepStrictEqual(watchers[0].options, { excludes: gitDirExcludes });
		});

		it('passes the .git excludes to every root and the common watcher of worktree repos', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);

			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), makeCallbacks());
			group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), makeCallbacks());

			assert.strictEqual(watchers.length, 3);
			for (const w of watchers) {
				assert.deepStrictEqual(w.options, { excludes: gitDirExcludes }, `watcher at ${w.basePath}`);
			}
		});

		it('never excludes a directory the .git globs read', () => {
			for (const exclude of gitDirExcludes) {
				assert.ok(
					!/^(?:refs|gk|info|rebase-apply|rebase-merge|sequencer|worktrees)(?:\/\*)?$/.test(exclude),
					`${exclude} is read by a watch glob`,
				);
			}
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

		for (const reason of ['create', 'change', 'delete'] as const) {
			it(`dispatches a shallow boundary ${reason} as a history change`, () => {
				const { factory, watchers } = createMockFactory();
				const group = new WatchGroup('/repo/.git', factory);
				const callbacks = makeCallbacks();
				group.addSession('/repo', standardGitDir('/repo/.git'), callbacks);

				watchers[0].fire({ path: '/repo/.git/shallow', reason: reason });

				assert.strictEqual(callCount(callbacks.onRepoChanged), 1);
				assert.deepStrictEqual(callArgs(callbacks.onRepoChanged, 0), ['/repo', ['heads'], undefined]);
				group.dispose();
			});
		}

		for (const reason of ['create', 'change', 'delete'] as const) {
			it(`dispatches a replacement ref ${reason} as a history change`, () => {
				const { factory, watchers } = createMockFactory();
				const group = new WatchGroup('/repo/.git', factory);
				const callbacks = makeCallbacks();
				group.addSession('/repo', standardGitDir('/repo/.git'), callbacks);

				watchers[0].fire({ path: '/repo/.git/refs/replace/0123456789abcdef', reason: reason });

				assert.strictEqual(callCount(callbacks.onRepoChanged), 1);
				assert.deepStrictEqual(callArgs(callbacks.onRepoChanged, 0), [
					'/repo',
					['heads'],
					'refs/replace/0123456789abcdef',
				]);
				group.dispose();
			});
		}

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

		for (const reason of ['create', 'change', 'delete'] as const) {
			it(`shares a shallow boundary ${reason} with every linked worktree`, () => {
				const { factory, watchers } = createMockFactory();
				const group = new WatchGroup('/repo/.git', factory);
				const callbacksA = makeCallbacks();
				const callbacksB = makeCallbacks();
				group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), callbacksA);
				group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), callbacksB);
				const common = watchers.find(w => w.pattern === dotGitGlobCommon);
				assert.ok(common);

				common.fire({ path: '/repo/.git/shallow', reason: reason });

				assert.strictEqual(callCount(callbacksA.onRepoChanged), 1);
				assert.strictEqual(callCount(callbacksB.onRepoChanged), 1);
				assert.deepStrictEqual(callArgs(callbacksA.onRepoChanged, 0), ['/worktrees/A', ['heads'], undefined]);
				assert.deepStrictEqual(callArgs(callbacksB.onRepoChanged, 0), ['/worktrees/B', ['heads'], undefined]);
				group.dispose();
			});
		}

		for (const reason of ['create', 'change', 'delete'] as const) {
			it(`shares a replacement ref ${reason} with every linked worktree`, () => {
				const { factory, watchers } = createMockFactory();
				const group = new WatchGroup('/repo/.git', factory);
				const callbacksA = makeCallbacks();
				const callbacksB = makeCallbacks();
				group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), callbacksA);
				group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), callbacksB);
				const common = watchers.find(w => w.pattern === dotGitGlobCommon);
				assert.ok(common);

				common.fire({ path: '/repo/.git/refs/replace/0123456789abcdef', reason: reason });

				assert.strictEqual(callCount(callbacksA.onRepoChanged), 1);
				assert.strictEqual(callCount(callbacksB.onRepoChanged), 1);
				assert.deepStrictEqual(callArgs(callbacksA.onRepoChanged, 0), [
					'/worktrees/A',
					['heads'],
					'refs/replace/0123456789abcdef',
				]);
				assert.deepStrictEqual(callArgs(callbacksB.onRepoChanged, 0), [
					'/worktrees/B',
					['heads'],
					'refs/replace/0123456789abcdef',
				]);
				group.dispose();
			});
		}

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

	describe('event routing — worktree state', () => {
		function setup(): {
			watchers: MockWatcher[];
			rootA: MockWatcher;
			common: MockWatcher;
			cbA: WatchGroupHooks;
			cbB: WatchGroupHooks;
		} {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const cbA = makeCallbacks();
			const cbB = makeCallbacks();
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), cbA);
			group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), cbB);
			const rootA = watchers.find(w => w.basePath === '/repo/.git/worktrees/A');
			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(rootA);
			assert.ok(common);
			return { watchers: watchers, rootA: rootA, common: common, cbA: cbA, cbB: cbB };
		}

		it("does not fan a worktree's index / MERGE_HEAD out from the common watcher", () => {
			const { common, cbA, cbB } = setup();

			common.fire({ path: '/repo/.git/worktrees/A/index', reason: 'change' });
			common.fire({ path: '/repo/.git/worktrees/A/MERGE_HEAD', reason: 'create' });

			assert.strictEqual(callCount(cbA.onRepoChanged), 0);
			assert.strictEqual(callCount(cbB.onRepoChanged), 0);
		});

		it("delivers a worktree's own index / MERGE_HEAD only to it, via its root watcher", () => {
			const { rootA, cbA, cbB } = setup();

			rootA.fire({ path: '/repo/.git/worktrees/A/index', reason: 'change' });
			rootA.fire({ path: '/repo/.git/worktrees/A/MERGE_HEAD', reason: 'create' });

			assert.strictEqual(callCount(cbA.onRepoChanged), 2);
			assert.deepStrictEqual(callArgs(cbA.onRepoChanged, 0), ['/worktrees/A', ['index'], undefined]);
			assert.deepStrictEqual(callArgs(cbA.onRepoChanged, 1), ['/worktrees/A', ['merge', 'pausedOp'], undefined]);
			assert.strictEqual(callCount(cbB.onRepoChanged), 0);
		});

		it("tells siblings, but not the owner, when a worktree's HEAD changes", () => {
			const { common, cbA, cbB } = setup();

			common.fire({ path: '/repo/.git/worktrees/A/HEAD', reason: 'change' });
			assert.strictEqual(callCount(cbA.onRepoChanged), 0);
			assert.strictEqual(callCount(cbB.onRepoChanged), 1);
			assert.deepStrictEqual(callArgs(cbB.onRepoChanged, 0), ['/worktrees/B', ['worktrees'], undefined]);
		});

		it("tells every session, the owner included, when a worktree's locked / gitdir changes", () => {
			const { common, cbA, cbB } = setup();

			// The owner's root watcher doesn't watch these, so the common watcher is its only source
			common.fire({ path: '/repo/.git/worktrees/A/locked', reason: 'create' });
			common.fire({ path: '/repo/.git/worktrees/A/gitdir', reason: 'change' });
			assert.strictEqual(callCount(cbA.onRepoChanged), 2);
			assert.deepStrictEqual(callArgs(cbA.onRepoChanged, 0), ['/worktrees/A', ['worktrees'], undefined]);
			assert.strictEqual(callCount(cbB.onRepoChanged), 2);
		});

		it('does not mistake a sibling whose id shares a prefix for the owner', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const cbA = makeCallbacks();
			const cbAB = makeCallbacks();
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), cbA);
			group.addSession('/worktrees/AB', worktreeGitDir('/repo/.git/worktrees/AB', '/repo/.git'), cbAB);

			watchers
				.find(w => w.pattern === dotGitGlobCommon)!
				.fire({
					path: '/repo/.git/worktrees/A/HEAD',
					reason: 'change',
				});

			assert.strictEqual(callCount(cbA.onRepoChanged), 0);
			assert.strictEqual(callCount(cbAB.onRepoChanged), 1);
		});

		it('tells every session, the owner included, when a worktree is removed', () => {
			const { common, cbA, cbB } = setup();

			common.fire({ path: '/repo/.git/worktrees/A', reason: 'delete' });

			assert.deepStrictEqual(callArgs(cbA.onRepoChanged, 0), ['/worktrees/A', ['worktrees'], undefined]);
			assert.deepStrictEqual(callArgs(cbB.onRepoChanged, 0), ['/worktrees/B', ['worktrees'], undefined]);
			assert.strictEqual(callCount(cbA.onRepoChanged), 1);
			assert.strictEqual(callCount(cbB.onRepoChanged), 1);
		});
	});

	describe('overflow', () => {
		const fullKinds = [
			'index',
			'head',
			'heads',
			'tags',
			'stash',
			'remotes',
			'worktrees',
			'config',
			'cherryPick',
			'merge',
			'rebase',
			'revert',
			'pausedOp',
			'ignores',
			'gkConfig',
		];

		function hooks() {
			return makeCallbacks({
				onFetchHeadChanged: mock.fn() as unknown as (repoPath: string) => void,
				onIgnoresChanged: mock.fn() as unknown as (repoPath: string) => void,
			});
		}

		it('exports every watcher-observable kind, never unknown', () => {
			assert.deepStrictEqual([...allWatchedRepositoryChanges], fullKinds);
		});

		it('a root watcher overflow gives its session every kind with no ref, marked as overflow, plus its hooks', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const a = hooks();
			const b = hooks();
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), a);
			group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), b);

			watchers
				.find(w => w.basePath === '/repo/.git/worktrees/A')!
				.fire({
					path: '/repo/.git/worktrees/A',
					reason: 'overflow',
				});

			assert.strictEqual(callCount(a.onRepoChanged), 1);
			assert.deepStrictEqual(callArgs(a.onRepoChanged, 0), ['/worktrees/A', fullKinds, undefined, true]);
			assert.ok(!(callArgs(a.onRepoChanged, 0)[1] as string[]).includes('unknown'));
			assert.strictEqual(callCount(a.onFetchHeadChanged), 1);
			assert.strictEqual(callCount(a.onIgnoresChanged), 1);
			assert.strictEqual(callCount(b.onRepoChanged), 0);
		});

		it('a common watcher overflow reaches linked sessions but not a main checkout it duplicates', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const main = hooks();
			const linked = hooks();
			group.addSession('/repo', standardGitDir('/repo/.git'), main);
			group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), linked);

			watchers.find(w => w.pattern === dotGitGlobCommon)!.fire({ path: '/repo/.git', reason: 'overflow' });

			assert.strictEqual(callCount(main.onRepoChanged), 0);
			assert.strictEqual(callCount(main.onFetchHeadChanged), 0);
			assert.strictEqual(callCount(linked.onRepoChanged), 1);
			assert.deepStrictEqual(callArgs(linked.onRepoChanged, 0), ['/worktrees/B', fullKinds, undefined, true]);
			assert.strictEqual(callCount(linked.onFetchHeadChanged), 1);
			assert.strictEqual(callCount(linked.onIgnoresChanged), 1);

			// The main checkout's own root watcher still reports it
			watchers.find(w => w.pattern === dotGitGlobCombined)!.fire({ path: '/repo/.git', reason: 'overflow' });
			assert.strictEqual(callCount(main.onRepoChanged), 1);
			assert.deepStrictEqual(callArgs(main.onRepoChanged, 0), ['/repo', fullKinds, undefined, true]);
		});
	});

	describe('event routing — main checkout alongside a linked worktree', () => {
		it('delivers each common-dir event to the main checkout exactly once, hooks included', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const mainChanged = mock.fn();
			const mainFetch = mock.fn() as unknown as (repoPath: string) => void;
			const mainIgnores = mock.fn() as unknown as (repoPath: string) => void;
			const cbB = makeCallbacks({
				onFetchHeadChanged: mock.fn() as unknown as (repoPath: string) => void,
				onIgnoresChanged: mock.fn() as unknown as (repoPath: string) => void,
			});
			group.addSession(
				'/repo',
				standardGitDir('/repo/.git'),
				makeCallbacks({
					onRepoChanged: mainChanged,
					onFetchHeadChanged: mainFetch,
					onIgnoresChanged: mainIgnores,
				}),
			);
			group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), cbB);

			const mainRoot = watchers.find(w => w.pattern === dotGitGlobCombined);
			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(mainRoot);
			assert.ok(common);

			// A recursive watcher reports the same file on both
			for (const w of [mainRoot, common]) {
				w.fire({ path: '/repo/.git/refs/heads/x', reason: 'change' });
				w.fire({ path: '/repo/.git/FETCH_HEAD', reason: 'change' });
				w.fire({ path: '/repo/.git/info/exclude', reason: 'change' });
			}

			// refs/heads/x + info/exclude
			assert.strictEqual(callCount(mainChanged), 2);
			assert.deepStrictEqual(callArgs(mainChanged, 0), ['/repo', ['heads'], 'refs/heads/x']);
			assert.strictEqual(callCount(mainFetch), 1);
			assert.strictEqual(callCount(mainIgnores), 1);

			// The linked worktree still hears the common watcher
			assert.strictEqual(callCount(cbB.onRepoChanged), 2);
			assert.strictEqual(callCount(cbB.onFetchHeadChanged), 1);
			assert.strictEqual(callCount(cbB.onIgnoresChanged), 1);
		});

		it("tells the main checkout a linked worktree's HEAD changed, once", () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const mainChanged = mock.fn();
			group.addSession('/repo', standardGitDir('/repo/.git'), makeCallbacks({ onRepoChanged: mainChanged }));
			group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), makeCallbacks());

			const mainRoot = watchers.find(w => w.pattern === dotGitGlobCombined);
			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(mainRoot);
			assert.ok(common);

			for (const w of [mainRoot, common]) {
				w.fire({ path: '/repo/.git/worktrees/B/HEAD', reason: 'change' });
				w.fire({ path: '/repo/.git/worktrees/B/index', reason: 'change' });
			}

			assert.strictEqual(callCount(mainChanged), 1);
			assert.deepStrictEqual(callArgs(mainChanged, 0), ['/repo', ['worktrees'], undefined]);
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

		it('names the ref a loose ref lock file stands for', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const callbacks = makeCallbacks();
			group.addSession('/repo', standardGitDir('/repo/.git'), callbacks);

			watchers[0].fire({ path: '/repo/.git/refs/heads/main.lock', reason: 'create' });
			watchers[0].fire({ path: '/repo/.git/refs/heads/main', reason: 'create' });

			assert.deepStrictEqual(callArgs(callbacks.onRepoChanged, 0), ['/repo', ['heads'], 'refs/heads/main']);
			assert.deepStrictEqual(callArgs(callbacks.onRepoChanged, 1), ['/repo', ['heads'], 'refs/heads/main']);
			group.dispose();
		});

		it("names HEAD on a linked worktree's root watcher", () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const callbacks = makeCallbacks();
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), callbacks);
			const rootA = watchers.find(w => w.basePath === '/repo/.git/worktrees/A');
			assert.ok(rootA);

			rootA.fire({ path: '/repo/.git/worktrees/A/HEAD', reason: 'change' });

			assert.deepStrictEqual(callArgs(callbacks.onRepoChanged, 0), ['/worktrees/A', ['head', 'heads'], 'HEAD']);
			group.dispose();
		});

		it('names no ref for config', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const callbacks = makeCallbacks();
			group.addSession('/repo', standardGitDir('/repo/.git'), callbacks);

			watchers[0].fire({ path: '/repo/.git/config', reason: 'change' });

			assert.deepStrictEqual(callArgs(callbacks.onRepoChanged, 0), ['/repo', ['config', 'remotes'], undefined]);
			group.dispose();
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

		it('disposes the common watcher when only a main checkout is left, and re-creates it for a new linked session', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);

			group.addSession('/repo', standardGitDir('/repo/.git'), makeCallbacks());
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), makeCallbacks());

			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(common);

			// The main checkout hears every common file from its own root watcher, so nothing needs the common one
			group.removeSession('/worktrees/A');
			assert.ok(common.disposed);
			assert.strictEqual(group.sessions.size, 1);

			group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), makeCallbacks());
			const commons = watchers.filter(w => w.pattern === dotGitGlobCommon);
			assert.strictEqual(commons.length, 2);
			assert.ok(!commons[1].disposed);
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

	describe('polling', () => {
		/** Files keyed by POSIX path; `touch` moves one's mtime */
		function createFs(paths: readonly string[]): {
			stat: (path: string) => Promise<{ mtime: number; size: number } | undefined>;
			touch: (path: string) => void;
			reads: Set<string>;
			/** How many times each path was statted */
			stats: Map<string, number>;
		} {
			const files = new Map<string, { mtime: number; size: number }>(paths.map(p => [p, { mtime: 1, size: 1 }]));
			const reads = new Set<string>();
			const stats = new Map<string, number>();
			return {
				reads: reads,
				stats: stats,
				stat: function (path: string): Promise<{ mtime: number; size: number } | undefined> {
					const p = normalizePath(path);
					reads.add(p);
					stats.set(p, (stats.get(p) ?? 0) + 1);
					return Promise.resolve(files.get(p));
				},
				touch: function (path: string): void {
					const file = files.get(path);
					files.set(path, { mtime: (file?.mtime ?? 0) + 1, size: file?.size ?? 1 });
				},
			};
		}

		/** Hooks that log what reached them, in order */
		function recordingHooks(log: string[], refs: readonly string[] = []): WatchGroupHooks {
			return {
				onRepoChanged: (repoPath, changes, ref, overflow) =>
					log.push(`${repoPath} ${changes.join(',')} ${ref ?? '-'}${overflow ? ' overflow' : ''}`),
				onFetchHeadChanged: repoPath => log.push(`${repoPath} fetch`),
				onIgnoresChanged: repoPath => log.push(`${repoPath} ignores`),
				getProbeRefs: () => refs,
				onUnwatchableChanged: repoPath => log.push(`${repoPath} mode`),
			};
		}

		const repoFiles = [
			'HEAD',
			'index',
			'ORIG_HEAD',
			'MERGE_HEAD',
			'CHERRY_PICK_HEAD',
			'REVERT_HEAD',
			'REBASE_HEAD',
			'rebase-merge',
			'rebase-apply',
			'sequencer',
			'logs/HEAD',
			'packed-refs',
			'config',
			'gk/config',
			'info/exclude',
			'refs/heads',
			'refs/heads/main',
			'refs/heads/feature',
			'refs/heads/feature/x',
			'refs/remotes/origin',
			'refs/remotes/origin/main',
			'refs/tags',
			'refs/stash',
			'worktrees',
			'shallow',
			'FETCH_HEAD',
		];
		const repoRefs = ['refs/heads/main', 'refs/heads/feature/x', 'refs/remotes/origin/main', 'HEAD'];

		function createPolledStandardRepo(initial: FileWatcherReliability | undefined): {
			group: WatchGroup;
			watchers: MockWatcher[];
			poller: GitDirPoller;
			fs: ReturnType<typeof createFs>;
			log: string[];
		} {
			const fs = createFs(repoFiles.map(f => `/repo/.git/${f}`));
			const poller = new GitDirPoller({
				stat: fs.stat,
				intervalMs: 0,
				activeCheckMs: 60_000,
				isActive: () => true,
			});
			const { factory, watchers } = createMockFactory(() => initial);
			const group = new WatchGroup('/repo/.git', factory, poller);
			const log: string[] = [];
			group.addSession('/repo', standardGitDir('/repo/.git'), recordingHooks(log, repoRefs));
			return { group: group, watchers: watchers, poller: poller, fs: fs, log: log };
		}

		it('asks no watcher about its reliability without a poller', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), makeCallbacks());

			assert.strictEqual(watchers.length, 2);
			for (const w of watchers) {
				assert.deepStrictEqual(w.options, { excludes: gitDirExcludes });
			}
			group.dispose();
		});

		it('asks every .git watcher about its reliability with a poller', () => {
			const poller = new GitDirPoller({ stat: () => Promise.resolve(undefined), isActive: () => true });
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory, poller);
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), makeCallbacks());

			assert.strictEqual(watchers.length, 2);
			for (const w of watchers) {
				assert.deepStrictEqual(w.options?.excludes, gitDirExcludes);
				assert.strictEqual(typeof w.options?.onDidChangeReliability, 'function');
			}
			group.dispose();
			poller.dispose();
		});

		for (const file of repoFiles.filter(f => f !== 'logs/HEAD' && f !== 'FETCH_HEAD')) {
			it(`interprets a polled ${file} exactly as the watcher's event for it`, async () => {
				const { factory, watchers } = createMockFactory();
				const nativeGroup = new WatchGroup('/repo/.git', factory);
				const nativeLog: string[] = [];
				nativeGroup.addSession('/repo', standardGitDir('/repo/.git'), recordingHooks(nativeLog));
				watchers[0].fire({ path: `/repo/.git/${file}`, reason: 'change' });
				nativeGroup.dispose();

				const { group, poller, fs, log } = createPolledStandardRepo('unwatchable');
				await poller.tick();
				log.length = 0;
				fs.touch(`/repo/.git/${file}`);
				await poller.tick();

				assert.ok(nativeLog.length > 0, `the watcher reports ${file}`);
				assert.deepStrictEqual(log, nativeLog);
				group.dispose();
				poller.dispose();
			});
		}

		it('reports a moved logs/HEAD as HEAD, naming it', async () => {
			const { group, poller, fs, log } = createPolledStandardRepo('unwatchable');
			await poller.tick();
			log.length = 0;

			fs.touch('/repo/.git/logs/HEAD');
			await poller.tick();

			assert.deepStrictEqual(log, ['/repo head,heads HEAD']);
			group.dispose();
			poller.dispose();
		});

		it('reports a moved FETCH_HEAD to the fetch hook and as a remotes change', async () => {
			const { group, poller, fs, log } = createPolledStandardRepo('unwatchable');
			await poller.tick();
			log.length = 0;

			fs.touch('/repo/.git/FETCH_HEAD');
			await poller.tick();

			assert.deepStrictEqual(log, ['/repo fetch', '/repo remotes refs/remotes']);
			group.dispose();
			poller.dispose();
		});

		it("stats the session's refs and the directories between them and their namespace", async () => {
			const { group, poller, fs } = createPolledStandardRepo('unwatchable');
			await poller.tick();

			for (const path of [
				'/repo/.git/refs/heads/main',
				'/repo/.git/refs/heads/feature/x',
				'/repo/.git/refs/heads/feature',
				'/repo/.git/refs/remotes/origin/main',
				'/repo/.git/refs/remotes/origin',
			]) {
				assert.ok(fs.reads.has(path), path);
			}
			assert.ok(!fs.reads.has('/repo/.git/refs/remotes'), 'FETCH_HEAD stands for refs/remotes');
			group.dispose();
			poller.dispose();
		});

		it('polls a watcher that is unwatchable from the start without a rescan', async () => {
			const { group, poller, log } = createPolledStandardRepo('unwatchable');

			assert.deepStrictEqual(log, ['/repo mode']);
			assert.strictEqual(poller.size, 1);
			assert.ok(group.isUnwatchable('/repo'));

			await poller.tick();
			assert.deepStrictEqual(log, ['/repo mode'], 'the first poll only records');
			group.dispose();
			poller.dispose();
		});

		it('rescans when the watch goes down and when it comes back, polling only meanwhile', () => {
			const { group, watchers, poller, log } = createPolledStandardRepo(undefined);
			assert.strictEqual(poller.size, 0);
			assert.ok(!group.isUnwatchable('/repo'));

			const overflow = `/repo ${allWatchedRepositoryChanges.join(',')} - overflow`;
			watchers[0].report('unwatchable');
			assert.deepStrictEqual(log, [overflow, '/repo fetch', '/repo ignores', '/repo mode']);
			assert.strictEqual(poller.size, 1);
			assert.ok(group.isUnwatchable('/repo'));

			log.length = 0;
			watchers[0].report('reliable');
			assert.deepStrictEqual(log, [overflow, '/repo fetch', '/repo ignores', '/repo mode']);
			assert.strictEqual(poller.size, 0);
			assert.ok(!group.isUnwatchable('/repo'));
			group.dispose();
			poller.dispose();
		});

		it('polls beside an unreliable watcher, without reporting again what the watcher reported', async () => {
			const { group, watchers, poller, fs, log } = createPolledStandardRepo('unreliable');
			assert.deepStrictEqual(log, []);
			assert.strictEqual(poller.size, 1);
			assert.ok(!group.isUnwatchable('/repo'));

			await poller.tick();
			fs.touch('/repo/.git/HEAD');
			fs.touch('/repo/.git/index');
			watchers[0].fire({ path: '/repo/.git/HEAD', reason: 'change' });
			await poller.tick();

			assert.deepStrictEqual(log, ['/repo head,heads HEAD', '/repo index -']);
			group.dispose();
			poller.dispose();
		});

		it('ignores a report from a removed session, and stops polling it', () => {
			const { group, watchers, poller, log } = createPolledStandardRepo('unwatchable');
			log.length = 0;

			group.removeSession('/repo');
			assert.strictEqual(poller.size, 0);

			watchers[0].report('reliable');
			assert.deepStrictEqual(log, []);
			group.dispose();
			poller.dispose();
		});

		describe('linked worktrees', () => {
			function createPolledLinkedRepo(): {
				group: WatchGroup;
				watchers: MockWatcher[];
				poller: GitDirPoller;
				fs: ReturnType<typeof createFs>;
				log: string[];
			} {
				const fs = createFs([
					...repoFiles.map(f => `/repo/.git/${f}`),
					'/repo/.git/refs/heads/a',
					'/repo/.git/refs/heads/b',
					'/repo/.git/worktrees/A/HEAD',
					'/repo/.git/worktrees/B/HEAD',
				]);
				const poller = new GitDirPoller({
					stat: fs.stat,
					intervalMs: 0,
					activeCheckMs: 60_000,
					isActive: () => true,
				});
				const { factory, watchers } = createMockFactory(() => 'unwatchable');
				const group = new WatchGroup('/repo/.git', factory, poller);
				const log: string[] = [];
				group.addSession(
					'/worktrees/A',
					worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'),
					recordingHooks(log, ['refs/heads/a']),
				);
				group.addSession(
					'/worktrees/B',
					worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'),
					recordingHooks(log, ['refs/heads/b']),
				);
				return { group: group, watchers: watchers, poller: poller, fs: fs, log: log };
			}

			it('polls the common files once for every linked session, with all of their refs', async () => {
				const { group, poller, fs, log } = createPolledLinkedRepo();
				// Each root, and the common dir
				assert.strictEqual(poller.size, 3);
				assert.ok(group.isUnwatchable('/worktrees/A'));

				await poller.tick();
				assert.ok(fs.reads.has('/repo/.git/refs/heads/a'));
				assert.ok(fs.reads.has('/repo/.git/refs/heads/b'));

				log.length = 0;
				fs.touch('/repo/.git/refs/heads/b');
				await poller.tick();

				assert.deepStrictEqual(log, ['/worktrees/A heads refs/heads/b', '/worktrees/B heads refs/heads/b']);
				group.dispose();
				poller.dispose();
			});

			it("delivers a worktree's own polled HEAD to it alone", async () => {
				const { group, poller, fs, log } = createPolledLinkedRepo();
				await poller.tick();
				log.length = 0;

				fs.touch('/repo/.git/worktrees/A/HEAD');
				await poller.tick();

				assert.deepStrictEqual(log, ['/worktrees/A head,heads HEAD']);
				group.dispose();
				poller.dispose();
			});

			it('rescans every linked session when the common watch comes back', () => {
				const { group, watchers, poller, log } = createPolledLinkedRepo();
				const common = watchers.find(w => w.pattern === dotGitGlobCommon);
				assert.ok(common);
				log.length = 0;

				common.report('reliable');

				const overflow = allWatchedRepositoryChanges.join(',');
				assert.deepStrictEqual(log, [
					`/worktrees/A ${overflow} - overflow`,
					'/worktrees/A fetch',
					'/worktrees/A ignores',
					'/worktrees/A mode',
					`/worktrees/B ${overflow} - overflow`,
					'/worktrees/B fetch',
					'/worktrees/B ignores',
					'/worktrees/B mode',
				]);
				assert.strictEqual(poller.size, 2);
				assert.ok(group.isUnwatchable('/worktrees/A'), 'its root watcher is still down');
				group.dispose();
				poller.dispose();
			});

			describe('beside the main checkout', () => {
				function createPolledMainAndLinkedRepo(): {
					group: WatchGroup;
					poller: GitDirPoller;
					fs: ReturnType<typeof createFs>;
					log: string[];
				} {
					const fs = createFs([
						...repoFiles.map(f => `/repo/.git/${f}`),
						'/repo/.git/refs/heads/feature/a',
						'/repo/.git/worktrees/A/HEAD',
						'/repo/.git/worktrees/A/index',
						'/repo/.git/worktrees/A/logs/HEAD',
					]);
					const poller = new GitDirPoller({
						stat: fs.stat,
						intervalMs: 0,
						activeCheckMs: 60_000,
						isActive: () => true,
					});
					const { factory } = createMockFactory(() => 'unwatchable');
					const group = new WatchGroup('/repo/.git', factory, poller);
					const log: string[] = [];
					group.addSession('/repo', standardGitDir('/repo/.git'), recordingHooks(log, ['refs/heads/main']));
					group.addSession(
						'/worktrees/A',
						worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'),
						recordingHooks(log, ['refs/heads/feature/a']),
					);
					return { group: group, poller: poller, fs: fs, log: log };
				}

				it("polls a linked session's refs for the main checkout too", async () => {
					const { group, poller, fs, log } = createPolledMainAndLinkedRepo();
					await poller.tick();
					log.length = 0;

					fs.touch('/repo/.git/refs/heads/feature/a');
					await poller.tick();

					assert.deepStrictEqual(log.sort(), [
						'/repo heads refs/heads/feature/a',
						'/worktrees/A heads refs/heads/feature/a',
					]);
					group.dispose();
					poller.dispose();
				});

				it("reports a linked worktree's moved logs/HEAD to the main checkout as an unnamed heads change", async () => {
					const { group, poller, fs, log } = createPolledMainAndLinkedRepo();
					await poller.tick();
					log.length = 0;

					fs.touch('/repo/.git/worktrees/A/logs/HEAD');
					await poller.tick();

					assert.deepStrictEqual(log, ['/worktrees/A head,heads HEAD', '/repo heads -']);
					group.dispose();
					poller.dispose();
				});

				it('stats each common file once per pass for the main checkout and the common dir', async () => {
					const { group, poller, fs } = createPolledMainAndLinkedRepo();
					// Each root, and the common dir
					assert.strictEqual(poller.size, 3);
					await poller.tick();

					fs.stats.clear();
					await poller.tick();

					for (const path of [
						...gitDirCommonProbes.map(p => `/repo/.git/${p.path}`),
						'/repo/.git/refs/heads/main',
						'/repo/.git/refs/heads/feature/a',
						'/repo/.git/refs/heads/feature',
						'/repo/.git/HEAD',
					]) {
						assert.strictEqual(fs.stats.get(path), 1, path);
					}
					assert.ok(
						[...fs.stats.values()].every(n => n === 1),
						'no path is statted twice',
					);
					group.dispose();
					poller.dispose();
				});

				it('reports the common files to both sessions, and a ref only the main checkout names to it', async () => {
					const { group, poller, fs, log } = createPolledMainAndLinkedRepo();
					await poller.tick();

					for (const [file, expected] of [
						['packed-refs', ['/repo heads,remotes,tags -', '/worktrees/A heads,remotes,tags -']],
						['config', ['/repo config,remotes -', '/worktrees/A config,remotes -']],
						['refs/heads/main', ['/repo heads refs/heads/main']],
					] as const) {
						log.length = 0;
						fs.touch(`/repo/.git/${file}`);
						await poller.tick();
						assert.deepStrictEqual(log.sort(), expected, file);
					}
					group.dispose();
					poller.dispose();
				});

				it('keeps polling the common files for the main checkout once the last linked session goes', async () => {
					const { group, poller, fs, log } = createPolledMainAndLinkedRepo();
					await poller.tick();

					group.removeSession('/worktrees/A');
					assert.strictEqual(poller.size, 1, 'only the main checkout');

					fs.stats.clear();
					log.length = 0;
					fs.touch('/repo/.git/packed-refs');
					fs.touch('/repo/.git/refs/heads/main');
					await poller.tick();

					assert.deepStrictEqual(log.sort(), ['/repo heads refs/heads/main', '/repo heads,remotes,tags -']);
					assert.ok([...fs.stats.values()].every(n => n === 1));
					group.dispose();
					poller.dispose();
				});
			});

			it('stops polling the common dir with the last linked session', () => {
				const { group, poller } = createPolledLinkedRepo();

				group.removeSession('/worktrees/A');
				assert.strictEqual(poller.size, 2);
				group.removeSession('/worktrees/B');
				assert.strictEqual(poller.size, 0);
				group.dispose();
				poller.dispose();
			});
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
