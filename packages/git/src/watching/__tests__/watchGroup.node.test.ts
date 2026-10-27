import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { Cache } from '../../cache.js';
import { FileType } from '../../context.js';
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

		it("leaves the ignored worktrees' folders unwatched by the watchers over the common git dir only", () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory, undefined, undefined, undefined, undefined, [
				'sync-tools-worktrees',
				'./tools\\checkouts/',
				'sync-tools-worktrees/',
				// Never the admin entries, a folder outside the git dir, or anything an exclude would take for a glob
				'worktrees',
				'Worktrees/x',
				'../outside',
				'/elsewhere',
				'build-*',
			]);

			group.addSession('/repo', standardGitDir('/repo/.git'), makeCallbacks());
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), makeCallbacks());

			const folders = [...gitDirExcludes, 'sync-tools-worktrees', 'tools/checkouts'];
			assert.deepStrictEqual(watchers.find(w => w.pattern === dotGitGlobCombined)?.options, {
				excludes: folders,
			});
			assert.deepStrictEqual(watchers.find(w => w.pattern === dotGitGlobCommon)?.options, { excludes: folders });
			assert.deepStrictEqual(watchers.find(w => w.pattern === dotGitGlobRoot)?.options, {
				excludes: gitDirExcludes,
			});
			group.dispose();
		});

		it('keeps watching a folder that shares a top-level directory with what the .git watch reads', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory, undefined, undefined, undefined, undefined, [
				'sync-tools-worktrees',
				'refs/sync',
				'Info/checkouts',
				'gk',
				'logs/checkouts',
				'tool_HEAD',
			]);

			group.addSession('/repo', standardGitDir('/repo/.git'), makeCallbacks());

			assert.deepStrictEqual(watchers[0].options, { excludes: [...gitDirExcludes, 'sync-tools-worktrees'] });
			group.dispose();
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
			assert.deepStrictEqual(callArgs(cbB.onRepoChanged, 0), [
				'/worktrees/B',
				['worktrees', 'worktreeHead'],
				undefined,
			]);
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

		it('tells every session, the owner included, when a worktree is removed, its HEAD with it', () => {
			const { common, cbA, cbB } = setup();

			// A watcher may coalesce the removal's subtree into this one report, so none of the HEAD comes
			common.fire({ path: '/repo/.git/worktrees/A', reason: 'delete' });

			const removed = ['worktrees', 'worktreeHead'];
			assert.deepStrictEqual(callArgs(cbA.onRepoChanged, 0), ['/worktrees/A', removed, undefined]);
			assert.deepStrictEqual(callArgs(cbB.onRepoChanged, 0), ['/worktrees/B', removed, undefined]);
			assert.strictEqual(callCount(cbA.onRepoChanged), 1);
			assert.strictEqual(callCount(cbB.onRepoChanged), 1);
		});

		it("tells of a worktree's HEAD with every report that can stand for its entry created or removed", () => {
			for (const [path, reason] of [
				['/repo/.git/worktrees', 'delete'],
				['/repo/.git/worktrees', 'change'],
				['/repo/.git/worktrees/C', 'create'],
				['/repo/.git/worktrees/C/gitdir', 'delete'],
			] as const) {
				const { common, cbB } = setup();

				common.fire({ path: path, reason: reason });
				assert.deepStrictEqual(
					callArgs(cbB.onRepoChanged, 0),
					['/worktrees/B', ['worktrees', 'worktreeHead'], undefined],
					`${path} ${reason}`,
				);
			}
		});

		it("tells only of the list when a worktree's entry merely changed, as a watcher reports beside a lock", () => {
			const { common, cbA, cbB } = setup();

			common.fire({ path: '/repo/.git/worktrees/A/locked', reason: 'create' });
			common.fire({ path: '/repo/.git/worktrees/A', reason: 'change' });
			common.fire({ path: '/repo/.git/worktrees/A/gitdir', reason: 'change' });

			for (const [cb, path] of [
				[cbA, '/worktrees/A'],
				[cbB, '/worktrees/B'],
			] as const) {
				assert.strictEqual(callCount(cb.onRepoChanged), 3);
				for (let i = 0; i < 3; i++) {
					assert.deepStrictEqual(callArgs(cb.onRepoChanged, i), [path, ['worktrees'], undefined]);
				}
			}
		});
	});

	describe('ignored worktrees', () => {
		/** Lets the group's reads (promises around a fake file) run to completion */
		async function flushReads(): Promise<void> {
			for (let i = 0; i < 5; i++) {
				await new Promise(resolve => setImmediate(resolve));
			}
		}

		const ignoredRoots = ['/repo/.git/sync-tools-worktrees'];

		/** The admin entries of a main checkout, linked worktrees A and B, an ignored worktree and a user's own */
		function adminEntries(): Record<string, string | Promise<string> | null> {
			return {
				A: '/worktrees/A/.git\n',
				B: '/worktrees/B/.git\n',
				'x-1': '/repo/.git/sync-tools-worktrees/x/.git\n',
				// Inside the git dir, but under no folder the host registered: a user's own worktree
				mine: '/repo/.git/my-worktrees/x/.git\n',
			};
		}

		/**
		 * A main checkout and linked worktrees A and B, grouped over the admin entries in `entries`: listed by id, each
		 * read as its `gitdir` (a promise settles that read when it does, and `null` fails it, as an entry whose
		 * `gitdir` isn't written yet does). An id not in `entries` is neither listed nor readable, as a removed one.
		 */
		async function createGroup(
			entries: Record<string, string | Promise<string> | null>,
			options?: {
				roots?: readonly string[] | Promise<readonly string[]> | null;
				readFile?: false;
				readDirectory?: false;
				/** Holds back the first listing until it settles */
				firstListing?: Promise<void>;
				folders?: readonly string[];
				/** Names listed as files, beside the entries */
				files?: readonly string[];
			},
		): Promise<{
			group: WatchGroup;
			/** The `gitdir` files read */
			reads: string[];
			/** The directories listed */
			listings: string[];
			/** Fails each listing while set; `missing`, as a directory that isn't there */
			listing: { fails: boolean; missing: boolean };
			mainRoot: MockWatcher;
			common: MockWatcher;
			main: WatchGroupHooks;
			linkedA: WatchGroupHooks;
			linkedB: WatchGroupHooks;
		}> {
			const { factory, watchers } = createMockFactory();
			const reads: string[] = [];
			const listings: string[] = [];
			const listing = { fails: false, missing: false };
			let firstListing = options?.firstListing;
			const roots = options?.roots === undefined ? ignoredRoots : options.roots;
			const group = new WatchGroup(
				'/repo/.git',
				factory,
				undefined,
				options?.readFile === false
					? undefined
					: path => {
							const normalized = normalizePath(path);
							if (normalized === '/repo/.git/config') {
								return Promise.resolve(new TextEncoder().encode('[core]\n'));
							}

							reads.push(normalized);
							const id = /^\/repo\/\.git\/worktrees\/([^/]+)\/gitdir$/.exec(normalized)?.[1];
							const content = id != null ? entries[id] : undefined;
							return content != null
								? Promise.resolve(content).then(c => new TextEncoder().encode(c))
								: Promise.reject(new Error('ENOENT'));
						},
				options?.readDirectory === false
					? undefined
					: path => {
							listings.push(normalizePath(path));
							if (listing.missing) {
								return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
							}
							if (listing.fails) {
								return Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
							}

							const gate = firstListing;
							firstListing = undefined;
							return (gate ?? Promise.resolve()).then(() => [
								...Object.keys(entries).map(id => [id, FileType.Directory] as [string, number]),
								...(options?.files ?? []).map(name => [name, FileType.File] as [string, number]),
							]);
						},
				roots === null ? undefined : Promise.resolve(roots),
				options?.folders,
			);
			const main = makeCallbacks();
			const linkedA = makeCallbacks();
			const linkedB = makeCallbacks();
			group.addSession('/repo', standardGitDir('/repo/.git'), main);
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), linkedA);
			group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), linkedB);
			await flushReads();

			const mainRoot = watchers.find(w => w.pattern === dotGitGlobCombined);
			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			assert.ok(mainRoot);
			assert.ok(common);
			return {
				group: group,
				reads: reads,
				listings: listings,
				listing: listing,
				mainRoot: mainRoot,
				common: common,
				main: main,
				linkedA: linkedA,
				linkedB: linkedB,
			};
		}

		/** Reports `path` from both watchers, as a recursive watcher of the common dir and the main checkout's root does */
		function reportBoth(
			mainRoot: MockWatcher,
			common: MockWatcher,
			path: string,
			reason: FileWatchEvent['reason'],
		) {
			mainRoot.fire({ path: path, reason: reason });
			common.fire({ path: path, reason: reason });
		}

		/** How many changes each of the sessions heard */
		function heard(...hooks: WatchGroupHooks[]): number[] {
			return hooks.map(h => callCount(h.onRepoChanged));
		}

		/** Runs `test` with `setTimeout` faked, so the reads an entry gets once more run as the test ticks */
		async function withFakeTimers(test: () => Promise<void>): Promise<void> {
			mock.timers.enable({ apis: ['setTimeout'] });
			try {
				await test();
			} finally {
				mock.timers.reset();
			}
		}

		function readsOf(reads: string[], id: string): number {
			return reads.filter(r => r === `/repo/.git/worktrees/${id}/gitdir`).length;
		}

		it('lists the admin entries and reads each one once as it starts', async () => {
			const { group, reads, listings } = await createGroup(adminEntries());

			assert.deepStrictEqual(listings, ['/repo/.git/worktrees']);
			assert.deepStrictEqual(
				[...reads].sort(),
				['A', 'B', 'mine', 'x-1'].map(id => `/repo/.git/worktrees/${id}/gitdir`),
			);
			group.dispose();
		});

		it("tells a real worktree's HEAD move at once, reading nothing", async () => {
			const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(adminEntries());
			const baselineReads = reads.length;

			reportBoth(mainRoot, common, '/repo/.git/worktrees/A/HEAD', 'change');

			// The owner hears its own HEAD from its root watcher
			assert.deepStrictEqual(callArgs(main.onRepoChanged, 0), [
				'/repo',
				['worktrees', 'worktreeHead'],
				undefined,
			]);
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 0, 1]);
			assert.deepStrictEqual(callArgs(linkedB.onRepoChanged, 0), [
				'/worktrees/B',
				['worktrees', 'worktreeHead'],
				undefined,
			]);
			assert.strictEqual(reads.length, baselineReads);
			group.dispose();
		});

		it("tells no session of an ignored worktree's HEAD moves, reading nothing", async () => {
			const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(adminEntries());
			const baselineReads = reads.length;

			for (const file of ['HEAD', 'locked']) {
				reportBoth(mainRoot, common, `/repo/.git/worktrees/x-1/${file}`, 'change');
			}
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'change');
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
			assert.strictEqual(reads.length, baselineReads);
			group.dispose();
		});

		it('tells no session of an ignored worktree added after it started', async () => {
			const entries = adminEntries();
			delete entries['x-1'];
			const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);
			const baselineReads = reads.length;

			entries['x-1'] = '/repo/.git/sync-tools-worktrees/x/.git\n';
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'create');
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/gitdir', 'create');
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/HEAD', 'create');
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
			assert.ok(reads.slice(baselineReads).every(r => r === '/repo/.git/worktrees/x-1/gitdir'));
			group.dispose();
		});

		it('tells no session of an ignored worktree whose entry names it relative to the entry', async () => {
			const { group, mainRoot, common, main, linkedA } = await createGroup({
				'x-1': '../../sync-tools-worktrees/x/.git\n',
			});

			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/HEAD', 'change');
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA), [0, 0]);
			group.dispose();
		});

		it('tells no session of an ignored worktree named by the path its folder resolves to', async () => {
			const { group, mainRoot, common, main, linkedA } = await createGroup(
				{ 'x-1': '/private/repo/.git/sync-tools-worktrees/x/.git\n' },
				{ roots: ['/repo/.git/sync-tools-worktrees', '/private/repo/.git/sync-tools-worktrees'] },
			);

			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/HEAD', 'change');
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA), [0, 0]);
			group.dispose();
		});

		it("tells a real worktree's HEAD deleted and created again at once, reading nothing, and keeps it known", async () => {
			const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(adminEntries());
			const baselineReads = reads.length;

			// Git's lock file renamed over HEAD, as some watchers report it
			reportBoth(mainRoot, common, '/repo/.git/worktrees/A/HEAD', 'delete');
			reportBoth(mainRoot, common, '/repo/.git/worktrees/A/HEAD', 'create');
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [2, 0, 2]);

			reportBoth(mainRoot, common, '/repo/.git/worktrees/A/HEAD', 'change');
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [3, 0, 3]);
			await flushReads();
			assert.strictEqual(reads.length, baselineReads);
			group.dispose();
		});

		it("tells nothing of an ignored worktree's HEAD deleted and created again, reading nothing", async () => {
			const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(adminEntries());
			const baselineReads = reads.length;

			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/HEAD', 'delete');
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/HEAD', 'create');
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
			assert.strictEqual(reads.length, baselineReads);
			group.dispose();
		});

		it("delivers a worktree's admin entry inside the git dir but under no ignored folder", async () => {
			const { group, mainRoot, common, main, linkedA, linkedB } = await createGroup(adminEntries());

			reportBoth(mainRoot, common, '/repo/.git/worktrees/mine/HEAD', 'change');

			assert.deepStrictEqual(callArgs(main.onRepoChanged, 0), [
				'/repo',
				['worktrees', 'worktreeHead'],
				undefined,
			]);
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);
			group.dispose();
		});

		it('tells no session of the removal of an ignored worktree it found as it started', async () => {
			const entries = adminEntries();
			const { group, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

			delete entries['x-1'];
			for (const file of ['HEAD', 'locked', 'gitdir']) {
				reportBoth(mainRoot, common, `/repo/.git/worktrees/x-1/${file}`, 'delete');
			}
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'delete');
			reportBoth(mainRoot, common, '/repo/.git/worktrees', 'change');
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
			group.dispose();
		});

		it('delivers the removal of an entry it never knew', async () => {
			const { group, mainRoot, common, main, linkedA } = await createGroup(adminEntries());

			reportBoth(mainRoot, common, '/repo/.git/worktrees/gone', 'delete');

			assert.deepStrictEqual(callArgs(main.onRepoChanged, 0), [
				'/repo',
				['worktrees', 'worktreeHead'],
				undefined,
			]);
			assert.deepStrictEqual(heard(main, linkedA), [1, 1]);
			group.dispose();
		});

		it('rereads an id created again, so one reused by a regular worktree is delivered', async () => {
			const entries = adminEntries();
			const { group, reads, mainRoot, common, main, linkedA } = await createGroup(entries);

			delete entries['x-1'];
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'delete');
			entries['x-1'] = '/worktrees/x/.git\n';
			const beforeCreate = reads.length;
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'create');
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA), [1, 1]);
			assert.deepStrictEqual(reads.slice(beforeCreate), [
				'/repo/.git/worktrees/x-1/gitdir',
				'/repo/.git/worktrees/x-1/gitdir',
			]);

			// Known as real now: its HEAD moves are told at once
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/HEAD', 'change');
			assert.deepStrictEqual(heard(main, linkedA), [2, 2]);
			group.dispose();
		});

		it("holds a new entry read before its gitdir is written until that write's report reads it", async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, common, linkedA } = await createGroup(entries);

				entries.y = null;
				common.fire({ path: '/repo/.git/worktrees/y', reason: 'create' });
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 0);

				// The write's report reads the entry, telling the held report with its own
				entries.y = '/worktrees/y/.git\n';
				common.fire({ path: '/repo/.git/worktrees/y/gitdir', reason: 'create' });
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 2);

				// Nothing is left to read again
				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(readsOf(reads, 'y'), 2);
				assert.strictEqual(callCount(linkedA.onRepoChanged), 2);
				group.dispose();
			});
		});

		it("reads an entry it doesn't know and can't read once more a moment later, then tells its report", async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, common, linkedA } = await createGroup(entries);

				entries.y = null;
				common.fire({ path: '/repo/.git/worktrees/y', reason: 'create' });
				await flushReads();
				mock.timers.tick(249);
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 0);
				assert.strictEqual(readsOf(reads, 'y'), 1);

				mock.timers.tick(1);
				await flushReads();
				assert.strictEqual(readsOf(reads, 'y'), 2);
				assert.strictEqual(callCount(linkedA.onRepoChanged), 1);

				// Once only
				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(readsOf(reads, 'y'), 2);
				group.dispose();
			});
		});

		it("tells nothing of an entry it couldn't read that turns out an ignored worktree's when read again", async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

				entries['x-2'] = null;
				reportBoth(mainRoot, common, '/repo/.git/worktrees/x-2', 'create');
				await flushReads();

				// Its gitdir was written, the write unseen
				entries['x-2'] = '/repo/.git/sync-tools-worktrees/x2/.git\n';
				mock.timers.tick(250);
				await flushReads();
				assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);

				// Known as ignored now: its HEAD moves are dropped, unread
				const known = reads.length;
				reportBoth(mainRoot, common, '/repo/.git/worktrees/x-2/HEAD', 'change');
				assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
				assert.strictEqual(reads.length, known);
				group.dispose();
			});
		});

		it("holds both watchers' reports of an entry it can't read on one read again", async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

				entries.y = null;
				reportBoth(mainRoot, common, '/repo/.git/worktrees/y', 'create');
				await flushReads();
				assert.strictEqual(readsOf(reads, 'y'), 2);

				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(readsOf(reads, 'y'), 3);
				assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);
				group.dispose();
			});
		});

		it('reads an entry it held no more once a removal of it is told', async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, common, linkedA } = await createGroup(entries);

				entries.y = null;
				common.fire({ path: '/repo/.git/worktrees/y', reason: 'create' });
				await flushReads();
				// Never known, so its removal is told as a real worktree's
				delete entries.y;
				common.fire({ path: '/repo/.git/worktrees/y', reason: 'delete' });
				assert.strictEqual(callCount(linkedA.onRepoChanged), 1);

				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(readsOf(reads, 'y'), 1);
				assert.strictEqual(callCount(linkedA.onRepoChanged), 1);
				group.dispose();
			});
		});

		it("forgets an ignored worktree's entry whose gitdir can't be read again, so its later reports are read", async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, common, linkedA } = await createGroup(entries);

				entries['x-1'] = null;
				common.fire({ path: '/repo/.git/worktrees/x-1/gitdir', reason: 'change' });
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 0);
				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 1);

				const forgotten = readsOf(reads, 'x-1');
				common.fire({ path: '/repo/.git/worktrees/x-1/HEAD', reason: 'change' });
				await flushReads();
				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(readsOf(reads, 'x-1'), forgotten + 2);
				assert.strictEqual(callCount(linkedA.onRepoChanged), 2);
				group.dispose();
			});
		});

		it("delivers a change of an entry it still can't read a moment later", async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, common, linkedA } = await createGroup(entries);

				entries.y = null;
				common.fire({ path: '/repo/.git/worktrees/y/HEAD', reason: 'change' });
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 0);

				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 1);
				group.dispose();
			});
		});

		it('keeps an entry removed while its gitdir was read unknown, so a worktree reusing its id is told', async () => {
			let settle!: (content: string) => void;
			const entries = adminEntries();
			const { group, common, linkedA } = await createGroup(entries);

			entries.y = new Promise<string>(resolve => {
				settle = resolve;
			});
			common.fire({ path: '/repo/.git/worktrees/y', reason: 'create' });
			// Never known, so its removal is told as a real worktree's
			common.fire({ path: '/repo/.git/worktrees/y', reason: 'delete' });
			assert.strictEqual(callCount(linkedA.onRepoChanged), 1);

			settle('/repo/.git/sync-tools-worktrees/y/.git\n');
			await flushReads();
			assert.strictEqual(callCount(linkedA.onRepoChanged), 1);

			// A regular worktree takes the id, its entry's creation coalesced away
			entries.y = '/worktrees/y/.git\n';
			common.fire({ path: '/repo/.git/worktrees/y/HEAD', reason: 'create' });
			await flushReads();
			assert.strictEqual(callCount(linkedA.onRepoChanged), 2);
			group.dispose();
		});

		it('decides a report whose read a later one superseded by what the later read found', async () => {
			let settleFirst!: (content: string) => void;
			const entries = adminEntries();
			const { group, common, main, linkedA, linkedB } = await createGroup(entries);

			// A tool moves a worktree into its folder while the read from before the move is still pending
			entries.y = new Promise<string>(resolve => {
				settleFirst = resolve;
			});
			common.fire({ path: '/repo/.git/worktrees/y/gitdir', reason: 'create' });
			entries.y = '/repo/.git/sync-tools-worktrees/y/.git\n';
			common.fire({ path: '/repo/.git/worktrees/y/gitdir', reason: 'change' });
			await flushReads();
			settleFirst('/worktrees/y/.git\n');
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
			group.dispose();
		});

		it('reads an entry removed before once another report of its id comes in, and tells it when real', async () => {
			const entries = adminEntries();
			const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

			delete entries['x-1'];
			for (const file of ['HEAD', 'gitdir']) {
				reportBoth(mainRoot, common, `/repo/.git/worktrees/x-1/${file}`, 'delete');
			}
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'delete');
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);

			// A regular worktree takes the id, its entry's creation unseen
			entries['x-1'] = '/worktrees/x/.git\n';
			const removed = readsOf(reads, 'x-1');
			reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/HEAD', 'change');
			await flushReads();

			assert.ok(readsOf(reads, 'x-1') > removed);
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);
			group.dispose();
		});

		it("takes a change of a removed entry it can't read for the removal's own, reading it no more", async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

				delete entries['x-1'];
				for (const file of ['HEAD', 'gitdir']) {
					reportBoth(mainRoot, common, `/repo/.git/worktrees/x-1/${file}`, 'delete');
				}
				await flushReads();
				// The entry's directory is reported changed beside the files the removal deleted, once they are gone
				const before = readsOf(reads, 'x-1');
				reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'change');
				await flushReads();
				const removed = readsOf(reads, 'x-1');
				assert.strictEqual(removed, before + 2);
				mock.timers.tick(250);
				await flushReads();

				assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
				assert.strictEqual(readsOf(reads, 'x-1'), removed);
				group.dispose();
			});
		});

		it("reads a removed entry created again once more a moment later when it can't read it yet, then tells it", async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

				delete entries['x-1'];
				reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'delete');
				entries['x-1'] = null;
				reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'create');
				await flushReads();
				assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
				const created = readsOf(reads, 'x-1');

				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(readsOf(reads, 'x-1'), created + 1);
				assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);
				group.dispose();
			});
		});

		it("still reads a removed entry created again once more when a change report's read superseded its own", async () => {
			await withFakeTimers(async () => {
				let settleCreated!: (content: string) => void;
				const entries = adminEntries();
				const { group, common, linkedA } = await createGroup(entries);

				delete entries['x-1'];
				common.fire({ path: '/repo/.git/worktrees/x-1', reason: 'delete' });
				entries['x-1'] = new Promise<string>(resolve => {
					settleCreated = resolve;
				});
				common.fire({ path: '/repo/.git/worktrees/x-1', reason: 'create' });
				entries['x-1'] = null;
				common.fire({ path: '/repo/.git/worktrees/x-1', reason: 'change' });
				await flushReads();
				settleCreated('/repo/.git/sync-tools-worktrees/x/.git\n');
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 0);

				// A regular worktree took the id
				entries['x-1'] = '/worktrees/x/.git\n';
				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 1);
				group.dispose();
			});
		});

		it("tells nothing of the removal of an ignored worktree's entry a read couldn't read just before", async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

				// The entry's `gitdir` report is read as git removes the entry
				entries['x-1'] = null;
				reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/gitdir', 'change');
				await flushReads();
				delete entries['x-1'];
				for (const file of ['HEAD', 'gitdir']) {
					reportBoth(mainRoot, common, `/repo/.git/worktrees/x-1/${file}`, 'delete');
				}
				reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'delete');
				mock.timers.tick(250);
				await flushReads();

				assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
				group.dispose();
			});
		});

		it('tells every session of a real worktree moved into an ignored folder, then nothing of it', async () => {
			const entries = adminEntries();
			const { group, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

			entries.B = '/repo/.git/sync-tools-worktrees/B/.git\n';
			reportBoth(mainRoot, common, '/repo/.git/worktrees/B/gitdir', 'change');
			await flushReads();

			// Every list lost it, the owner's included; the other watcher's report finds it told
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);

			reportBoth(mainRoot, common, '/repo/.git/worktrees/B/HEAD', 'change');
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);
			group.dispose();
		});

		it('tells every session of a real worktree moved into an ignored folder once unlocked', async () => {
			const entries = adminEntries();
			const { group, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

			reportBoth(mainRoot, common, '/repo/.git/worktrees/B/locked', 'create');
			reportBoth(mainRoot, common, '/repo/.git/worktrees/B/locked', 'delete');
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [2, 2, 2]);

			entries.B = '/repo/.git/sync-tools-worktrees/B/.git\n';
			reportBoth(mainRoot, common, '/repo/.git/worktrees/B/gitdir', 'change');
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA, linkedB), [3, 3, 3]);
			group.dispose();
		});

		it('tells every session once of a real entry the worktrees directory gained, and none of an ignored one', async () => {
			const entries = adminEntries();
			const { group, reads, listings, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);
			const baselineReads = reads.length;

			entries['x-2'] = '/repo/.git/sync-tools-worktrees/x2/.git\n';
			reportBoth(mainRoot, common, '/repo/.git/worktrees', 'change');
			await flushReads();
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
			assert.deepStrictEqual(reads.slice(baselineReads), ['/repo/.git/worktrees/x-2/gitdir']);

			entries.C = '/worktrees/C/.git\n';
			reportBoth(mainRoot, common, '/repo/.git/worktrees', 'change');
			await flushReads();
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);
			// A listing can't tell an entry added from one moved out of an ignored folder, so it tells of its HEAD too
			assert.deepStrictEqual(callArgs(linkedA.onRepoChanged, 0), [
				'/worktrees/A',
				['worktrees', 'worktreeHead'],
				undefined,
			]);

			// Nothing changed since
			reportBoth(mainRoot, common, '/repo/.git/worktrees', 'change');
			await flushReads();
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);
			assert.ok(listings.length > 1);
			group.dispose();
		});

		it('counts no entry for a file the worktrees directory lists', async () => {
			const entries = adminEntries();
			const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries, {
				files: ['.DS_Store'],
			});
			assert.strictEqual(readsOf(reads, '.DS_Store'), 0);

			reportBoth(mainRoot, common, '/repo/.git/worktrees', 'change');
			await flushReads();
			assert.strictEqual(readsOf(reads, '.DS_Store'), 0);
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
			group.dispose();
		});

		it('tells every session of a real entry the worktrees directory lost', async () => {
			const entries = adminEntries();
			const { group, common, main, linkedA, linkedB } = await createGroup(entries);

			delete entries.mine;
			common.fire({ path: '/repo/.git/worktrees', reason: 'change' });
			await flushReads();

			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);
			group.dispose();
		});

		it('counts an entry the worktrees directory gained whose gitdir is still unreadable a moment later as real', async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, common, linkedA } = await createGroup(entries);

				entries.y = null;
				common.fire({ path: '/repo/.git/worktrees', reason: 'change' });
				await flushReads();
				assert.strictEqual(callCount(linkedA.onRepoChanged), 0);

				mock.timers.tick(250);
				await flushReads();
				assert.strictEqual(readsOf(reads, 'y'), 2);
				assert.strictEqual(callCount(linkedA.onRepoChanged), 1);
				group.dispose();
			});
		});

		it('reads an entry the worktrees directory gained once more before counting it', async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, common, main, linkedA, linkedB } = await createGroup(entries);

				entries['x-2'] = null;
				common.fire({ path: '/repo/.git/worktrees', reason: 'create' });
				await flushReads();

				entries['x-2'] = '/repo/.git/sync-tools-worktrees/x2/.git\n';
				mock.timers.tick(250);
				await flushReads();
				assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);
				group.dispose();
			});
		});

		for (const reason of ['create', 'change'] as const) {
			it(`delivers the worktrees directory's ${reason} to its own sessions when it can't be listed`, async () => {
				const { group, listing, common, main, linkedA, linkedB } = await createGroup(adminEntries());

				listing.fails = true;
				common.fire({ path: '/repo/.git/worktrees', reason: reason });
				await flushReads();

				assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 1, 1]);
				group.dispose();
			});
		}

		it('takes a worktrees directory that is gone for an empty one whatever the report, so an entry added again is told', async () => {
			const entries: Record<string, string | null> = { C: '/worktrees/C/.git\n' };
			const { group, listing, common, main, linkedA, linkedB } = await createGroup(entries);

			// Git removed the directory with its last entry, which a poll sees as a change of it
			delete entries.C;
			listing.missing = true;
			common.fire({ path: '/repo/.git/worktrees', reason: 'change' });
			await flushReads();
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);

			// The same id added again
			listing.missing = false;
			entries.C = '/worktrees/C/.git\n';
			common.fire({ path: '/repo/.git/worktrees', reason: 'change' });
			await flushReads();
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [2, 2, 2]);
			group.dispose();
		});

		it("takes a removal of the worktrees directory it can't list for an empty one", async () => {
			const entries: Record<string, string | null> = { 'x-1': '/repo/.git/sync-tools-worktrees/x/.git\n' };
			const { group, listing, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

			// Git removed the directory with its last entry, an ignored worktree's
			delete entries['x-1'];
			listing.fails = true;
			reportBoth(mainRoot, common, '/repo/.git/worktrees', 'delete');
			await flushReads();
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [0, 0, 0]);

			listing.fails = false;
			entries.C = '/worktrees/C/.git\n';
			reportBoth(mainRoot, common, '/repo/.git/worktrees', 'create');
			await flushReads();
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);

			// The last entry, a real worktree's
			delete entries.C;
			listing.fails = true;
			reportBoth(mainRoot, common, '/repo/.git/worktrees', 'delete');
			await flushReads();
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [2, 2, 2]);
			group.dispose();
		});

		it('tells a report arriving before the admin entries are first listed and read at once', async () => {
			let list!: () => void;
			const { group, reads, common, linkedA, linkedB } = await createGroup(adminEntries(), {
				firstListing: new Promise<void>(resolve => {
					list = resolve;
				}),
			});

			common.fire({ path: '/repo/.git/worktrees/A/HEAD', reason: 'change' });
			common.fire({ path: '/repo/.git/worktrees/x-1/HEAD', reason: 'change' });
			assert.deepStrictEqual(heard(linkedA, linkedB), [1, 2]);

			list();
			await flushReads();

			// Decided once listed, which tells nothing more
			assert.deepStrictEqual(heard(linkedA, linkedB), [1, 2]);
			// Only the baseline's reads
			assert.strictEqual(reads.length, 4);
			group.dispose();
		});

		it('decides a report arriving while the admin entries are first read once they are, catching up with its write', async () => {
			let settle!: (content: string) => void;
			const entries = adminEntries();
			entries.y = new Promise<string>(resolve => {
				settle = resolve;
			});
			const { group, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

			// A real worktree is moved out of the folder while the baseline still reads where it was
			entries.y = '/worktrees/y/.git\n';
			reportBoth(mainRoot, common, '/repo/.git/worktrees/y/gitdir', 'change');
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 1, 1]);

			settle('/repo/.git/sync-tools-worktrees/y/.git\n');
			await flushReads();
			// The move is told to every session
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [2, 2, 2]);

			// Known as real: its HEAD moves are told
			common.fire({ path: '/repo/.git/worktrees/y/HEAD', reason: 'change' });
			assert.deepStrictEqual(heard(main, linkedA, linkedB), [2, 3, 3]);
			group.dispose();
		});

		it('lists and reads the admin entries again after a watcher dropped events', async () => {
			const entries = adminEntries();
			const { group, reads, listings, common, linkedA, linkedB } = await createGroup(entries);

			// Added while the watcher dropped its events
			entries['x-2'] = '/repo/.git/sync-tools-worktrees/x2/.git\n';
			common.fire({ path: '/repo/.git', reason: 'overflow' });
			await flushReads();
			assert.strictEqual(listings.length, 2);
			assert.ok(reads.includes('/repo/.git/worktrees/x-2/gitdir'));
			const overflowed = heard(linkedA, linkedB);

			const rebaselineReads = reads.length;
			common.fire({ path: '/repo/.git/worktrees/x-2/HEAD', reason: 'change' });
			assert.deepStrictEqual(heard(linkedA, linkedB), overflowed);
			assert.strictEqual(reads.length, rebaselineReads);
			group.dispose();
		});

		it('keeps only the latest read of an id when reads settle out of order', async () => {
			let settleInside!: (content: string) => void;
			const entries = adminEntries();
			const { group, common, linkedA } = await createGroup(entries);

			// The worktree moves out of the ignored folder while the read from before the move is still pending
			entries.y = new Promise<string>(resolve => {
				settleInside = resolve;
			});
			common.fire({ path: '/repo/.git/worktrees/y/gitdir', reason: 'change' });
			entries.y = '/worktrees/y/.git\n';
			common.fire({ path: '/repo/.git/worktrees/y/gitdir', reason: 'change' });
			await flushReads();
			assert.strictEqual(callCount(linkedA.onRepoChanged), 1);

			settleInside('/repo/.git/sync-tools-worktrees/y/.git\n');
			await flushReads();
			// The stale read's report is decided by what the latest read found, and doesn't make the regular worktree
			// look ignored
			assert.strictEqual(callCount(linkedA.onRepoChanged), 2);
			common.fire({ path: '/repo/.git/worktrees/y/HEAD', reason: 'change' });
			assert.strictEqual(callCount(linkedA.onRepoChanged), 3);
			group.dispose();
		});

		it('tells no session removed, or group disposed, while the entry was read', async () => {
			await withFakeTimers(async () => {
				const entries = adminEntries();
				const { group, reads, mainRoot, common, main, linkedA, linkedB } = await createGroup(entries);

				entries.y = '/worktrees/y/.git\n';
				reportBoth(mainRoot, common, '/repo/.git/worktrees/y', 'create');
				group.removeSession('/worktrees/A');
				await flushReads();

				assert.deepStrictEqual(heard(main, linkedA, linkedB), [1, 0, 1]);

				entries.z = '/worktrees/z/.git\n';
				reportBoth(mainRoot, common, '/repo/.git/worktrees/z', 'create');
				// Nor reads again, once disposed, an entry it couldn't read
				entries.w = null;
				common.fire({ path: '/repo/.git/worktrees/w', reason: 'create' });
				group.dispose();
				await flushReads();
				mock.timers.tick(250);
				await flushReads();

				assert.deepStrictEqual(heard(main, linkedB), [1, 1]);
				assert.strictEqual(readsOf(reads, 'w'), 1);
			});
		});

		for (const [name, options] of [
			['without a readFile', { readFile: false }],
			['without a readDirectory', { readDirectory: false }],
			['when no folder is registered', { roots: [] }],
			['when no folder is asked for', { roots: null }],
		] as const) {
			it(`delivers every admin entry report at once, reading nothing, ${name}`, async () => {
				const { group, reads, listings, mainRoot, common, main, linkedA } = await createGroup(
					adminEntries(),
					options,
				);

				reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1/HEAD', 'change');
				reportBoth(mainRoot, common, '/repo/.git/worktrees/x-1', 'delete');
				reportBoth(mainRoot, common, '/repo/.git/worktrees', 'change');

				assert.deepStrictEqual(heard(main, linkedA), [3, 3]);
				assert.deepStrictEqual(reads, []);
				assert.deepStrictEqual(listings, []);
				group.dispose();
			});
		}
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
			'worktreeHead',
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
			assert.deepStrictEqual(callArgs(mainChanged, 0), ['/repo', ['worktrees', 'worktreeHead'], undefined]);
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
			assert.deepStrictEqual(onRepoChanged.mock.calls[0].arguments, [
				'/worktrees/A',
				['config', 'remotes'],
				false,
			]);
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

		it("reports a loose ref's write by its rename over the ref, not by its lock file", () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const callbacks = makeCallbacks();
			group.addSession('/repo', standardGitDir('/repo/.git'), callbacks);

			watchers[0].fire({ path: '/repo/.git/refs/heads/main.lock', reason: 'create' });
			assert.strictEqual(callCount(callbacks.onRepoChanged), 0);

			watchers[0].fire({ path: '/repo/.git/refs/heads/main', reason: 'create' });
			watchers[0].fire({ path: '/repo/.git/refs/heads/main.lock', reason: 'delete' });

			assert.strictEqual(callCount(callbacks.onRepoChanged), 1);
			assert.deepStrictEqual(callArgs(callbacks.onRepoChanged, 0), ['/repo', ['heads'], 'refs/heads/main']);
			group.dispose();
		});

		it('names the stash for its lock file', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const callbacks = makeCallbacks();
			group.addSession('/repo', standardGitDir('/repo/.git'), callbacks);

			watchers[0].fire({ path: '/repo/.git/refs/stash.lock', reason: 'create' });

			assert.deepStrictEqual(callArgs(callbacks.onRepoChanged, 0), ['/repo', ['stash'], 'refs/stash']);
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

		// With nothing to read the file through, a config change may be anywhere
		for (const file of ['config', 'config.lock', 'config.worktree', 'config.worktree.lock']) {
			it(`reports ${file} as config invalidation without ref movement`, () => {
				const { factory, watchers } = createMockFactory();
				const group = new WatchGroup('/repo/.git', factory);
				const callbacks = makeCallbacks();
				group.addSession('/repo', standardGitDir('/repo/.git'), callbacks);

				watchers[0].fire({ path: `/repo/.git/${file}`, reason: 'change' });

				assert.deepStrictEqual(callArgs(callbacks.onRepoChanged, 0), ['/repo', ['config', 'remotes'], false]);
				group.dispose();
			});
		}

		it('keeps worktree config invalidation local to its owning linked checkout', () => {
			const { factory, watchers } = createMockFactory();
			const group = new WatchGroup('/repo/.git', factory);
			const a = makeCallbacks();
			const b = makeCallbacks();
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), a);
			group.addSession('/worktrees/B', worktreeGitDir('/repo/.git/worktrees/B', '/repo/.git'), b);
			const rootA = watchers.find(w => w.basePath === '/repo/.git/worktrees/A');
			assert.ok(rootA);

			rootA.fire({ path: '/repo/.git/worktrees/A/config.worktree.lock', reason: 'create' });
			rootA.fire({ path: '/repo/.git/worktrees/A/config.worktree', reason: 'change' });

			assert.strictEqual(callCount(a.onRepoChanged), 2);
			assert.deepStrictEqual(callArgs(a.onRepoChanged, 0), ['/worktrees/A', ['config', 'remotes'], false]);
			assert.deepStrictEqual(callArgs(a.onRepoChanged, 1), ['/worktrees/A', ['config', 'remotes'], false]);
			assert.strictEqual(callCount(b.onRepoChanged), 0);
			group.dispose();
		});
	});

	describe('classifying the shared config', () => {
		const base =
			'[core]\n\tbare = false\n[remote "origin"]\n\turl = /origin.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';
		const featureSection = '[branch "feature"]\n\tremote = origin\n\tmerge = refs/heads/feature\n';

		/** Lets the group's reads (promises around a fake file) run to completion */
		async function flushReads(): Promise<void> {
			for (let i = 0; i < 5; i++) {
				await new Promise(resolve => setImmediate(resolve));
			}
		}

		/** A main checkout and a linked worktree, grouped over a `.git/config` the test writes (`null`: unreadable) */
		async function createGroup(initial: string | null = base): Promise<{
			group: WatchGroup;
			file: { content: string | undefined; reads: string[] };
			mainRoot: MockWatcher;
			common: MockWatcher;
			linkedRoot: MockWatcher;
			main: WatchGroupHooks;
			linked: WatchGroupHooks;
			calls: (hooks: WatchGroupHooks) => unknown[][];
		}> {
			const { factory, watchers } = createMockFactory();
			const file: { content: string | undefined; reads: string[] } = { content: initial ?? undefined, reads: [] };
			const group = new WatchGroup('/repo/.git', factory, undefined, path => {
				file.reads.push(normalizePath(path));
				return file.content != null
					? Promise.resolve(new TextEncoder().encode(file.content))
					: Promise.reject(new Error('ENOENT'));
			});
			const main = makeCallbacks();
			const linked = makeCallbacks();
			group.addSession('/repo', standardGitDir('/repo/.git'), main);
			group.addSession('/worktrees/A', worktreeGitDir('/repo/.git/worktrees/A', '/repo/.git'), linked);
			await flushReads();

			const mainRoot = watchers.find(w => w.pattern === dotGitGlobCombined);
			const common = watchers.find(w => w.pattern === dotGitGlobCommon);
			const linkedRoot = watchers.find(w => w.basePath === '/repo/.git/worktrees/A');
			assert.ok(mainRoot);
			assert.ok(common);
			assert.ok(linkedRoot);
			return {
				group: group,
				file: file,
				mainRoot: mainRoot,
				common: common,
				linkedRoot: linkedRoot,
				main: main,
				linked: linked,
				calls: hooks =>
					(hooks.onRepoChanged as unknown as MockFn).mock.calls.map((c: { arguments: unknown[] }) => [
						...c.arguments,
					]),
			};
		}

		/** What git and the watchers do for one write: the lock, then the file it's renamed over, seen by both watchers */
		function reportWrite(...watchers: MockWatcher[]): void {
			for (const w of watchers) {
				w.fire({ path: '/repo/.git/config.lock', reason: 'create' });
				w.fire({ path: '/repo/.git/config', reason: 'change' });
			}
		}

		it("tells every session, once, that only a branch's section changed, with no remotes", async () => {
			const { group, file, mainRoot, common, main, linked, calls } = await createGroup();
			assert.deepStrictEqual(file.reads, ['/repo/.git/config'], 'the baseline is read as the group starts');

			file.content = base + featureSection;
			reportWrite(mainRoot, common);
			await flushReads();

			for (const [hooks, repoPath] of [
				[main, '/repo'],
				[linked, '/worktrees/A'],
			] as const) {
				assert.deepStrictEqual(calls(hooks), [
					[repoPath, ['config'], false, false, new Set(['refs/heads/feature'])],
				]);
			}
			// The first report's read and one follow-up for the reports that came in during it
			assert.strictEqual(file.reads.length, 3);
			group.dispose();
		});

		it('tells every session a change outside branch sections may be anywhere, remotes included', async () => {
			for (const edit of [
				base.replace('/origin.git', '/moved.git'),
				`${base}[url "https://mirror/"]\n\tinsteadOf = https://origin/\n`,
				`${base}[branch]\n\tautoSetupMerge = always\n`,
				`${base + featureSection}[core]\n\tfilemode = false\n`,
			]) {
				const { group, file, common, main, linked, calls } = await createGroup();

				file.content = edit;
				reportWrite(common);
				await flushReads();

				assert.deepStrictEqual(calls(main), [['/repo', ['config', 'remotes'], false]], edit);
				assert.deepStrictEqual(calls(linked), [['/worktrees/A', ['config', 'remotes'], false]], edit);
				group.dispose();
			}
		});

		it("tells no session of a report whose change an earlier report's read already delivered", async () => {
			const { group, file, mainRoot, main, calls } = await createGroup();

			file.content = base + featureSection;
			mainRoot.fire({ path: '/repo/.git/config', reason: 'change' });
			await flushReads();
			// The same write, reported again later (a polled watcher, or the other watcher)
			mainRoot.fire({ path: '/repo/.git/config', reason: 'change' });
			await flushReads();

			assert.strictEqual(calls(main).length, 1);
			group.dispose();
		});

		it('classifies a report by what changed since the last read, however long ago that was', async () => {
			const { group, file, common, linked, calls } = await createGroup();

			// Two writes, the first never reported (a poll that saw only the second): both are in the comparison
			file.content = base + featureSection;
			file.content += '[branch "other"]\n\tremote = origin\n';
			common.fire({ path: '/repo/.git/config', reason: 'change' });
			await flushReads();

			assert.deepStrictEqual(calls(linked), [
				['/worktrees/A', ['config'], false, false, new Set(['refs/heads/feature', 'refs/heads/other'])],
			]);
			group.dispose();
		});

		it("can't compare a report arriving while the baseline is read, so it is unconfined", async () => {
			const { factory, watchers } = createMockFactory();
			let resolveBaseline: ((data: Uint8Array) => void) | undefined;
			const group = new WatchGroup(
				'/repo/.git',
				factory,
				undefined,
				() =>
					new Promise<Uint8Array>(resolve => {
						resolveBaseline = resolve;
					}),
			);
			const hooks = makeCallbacks();
			group.addSession('/repo', standardGitDir('/repo/.git'), hooks);

			watchers[0].fire({ path: '/repo/.git/config', reason: 'change' });
			assert.deepStrictEqual(callArgs(hooks.onRepoChanged, 0), ['/repo', ['config', 'remotes'], false]);

			resolveBaseline?.(new TextEncoder().encode(base));
			await flushReads();
			assert.strictEqual(callCount(hooks.onRepoChanged), 1);
			group.dispose();
		});

		it("is unconfined for a file it couldn't read or parse, and compares the next read with the last good one", async () => {
			for (const failure of [
				undefined, // unreadable
				`${base}[branch "feature"]\n\tmerge = refs/heads/\\q\n`, // an escape git rejects
				`${base}[branch "feature\n\tmerge = x\n`, // a header git rejects
				`${base}\tstray = before any header`.replace('[core]', ''), // a variable outside any section
			]) {
				const { group, file, common, linked, calls } = await createGroup();

				file.content = failure;
				common.fire({ path: '/repo/.git/config', reason: 'change' });
				await flushReads();
				assert.deepStrictEqual(
					calls(linked),
					[['/worktrees/A', ['config', 'remotes'], false]],
					String(failure),
				);

				file.content = base + featureSection;
				common.fire({ path: '/repo/.git/config', reason: 'change' });
				await flushReads();
				assert.deepStrictEqual(
					calls(linked)[1],
					['/worktrees/A', ['config'], false, false, new Set(['refs/heads/feature'])],
					String(failure),
				);
				group.dispose();
			}
		});

		it('is unconfined for every report when the baseline could not be read, until a read succeeds', async () => {
			const { group, file, common, linked, calls } = await createGroup(null);

			file.content = base + featureSection;
			common.fire({ path: '/repo/.git/config', reason: 'change' });
			await flushReads();
			file.content = base;
			common.fire({ path: '/repo/.git/config', reason: 'change' });
			await flushReads();

			assert.deepStrictEqual(calls(linked), [
				['/worktrees/A', ['config', 'remotes'], false],
				['/worktrees/A', ['config'], false, false, new Set(['refs/heads/feature'])],
			]);
			group.dispose();
		});

		it('takes a read that never settles for a failed one, so the reports after it are still read', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			try {
				const { factory, watchers } = createMockFactory();
				let hang = false;
				let content = base;
				const group = new WatchGroup('/repo/.git', factory, undefined, () =>
					hang ? new Promise<Uint8Array>(() => {}) : Promise.resolve(new TextEncoder().encode(content)),
				);
				const hooks = makeCallbacks();
				group.addSession('/repo', standardGitDir('/repo/.git'), hooks);
				await flushReads();

				// A hung mount: the read of this report never settles
				hang = true;
				content = base + featureSection;
				watchers[0].fire({ path: '/repo/.git/config', reason: 'change' });
				await flushReads();
				assert.strictEqual(callCount(hooks.onRepoChanged), 0);

				// Another report waits behind it, and the mount recovers
				watchers[0].fire({ path: '/repo/.git/config', reason: 'change' });
				hang = false;
				mock.timers.tick(5000);
				await flushReads();

				assert.deepStrictEqual(callArgs(hooks.onRepoChanged, 0), ['/repo', ['config', 'remotes'], false]);
				assert.deepStrictEqual(callArgs(hooks.onRepoChanged, 1), [
					'/repo',
					['config'],
					false,
					false,
					new Set(['refs/heads/feature']),
				]);
				group.dispose();
			} finally {
				mock.timers.reset();
			}
		});

		it("leaves a linked worktree's own config file unconfined, and reads nothing for it", async () => {
			const { group, file, linkedRoot, main, linked, calls } = await createGroup();
			const reads = file.reads.length;

			linkedRoot.fire({ path: '/repo/.git/worktrees/A/config.worktree', reason: 'change' });
			await flushReads();

			assert.deepStrictEqual(calls(linked), [['/worktrees/A', ['config', 'remotes'], false]]);
			assert.deepStrictEqual(calls(main), []);
			assert.strictEqual(file.reads.length, reads);
			group.dispose();
		});

		it('delivers an overflow as every kind, unclassified', async () => {
			const { group, common, linked, calls } = await createGroup();

			common.fire({ path: '/repo/.git', reason: 'overflow' });
			await flushReads();

			assert.deepStrictEqual(calls(linked)[0], [
				'/worktrees/A',
				[...allWatchedRepositoryChanges],
				undefined,
				true,
			]);
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
			'refs/remotes',
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
				// Not for a named ref: for a remote's directory appearing or going
				'/repo/.git/refs/remotes',
			]) {
				assert.ok(fs.reads.has(path), path);
			}
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
						['config', ['/repo config,remotes false', '/worktrees/A config,remotes false']],
						['refs/remotes', ['/repo remotes refs/remotes', '/worktrees/A remotes refs/remotes']],
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
