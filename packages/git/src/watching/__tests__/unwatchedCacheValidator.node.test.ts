import assert from 'node:assert';
import { afterEach, describe, it, mock } from 'node:test';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { Cache } from '../../cache.js';
import { FileType } from '../../context.js';
import type { RepositoryChange } from '../../models/repository.js';
import { allWatchedRepositoryChanges } from '../classifyChange.js';
import { UnwatchedCacheValidator } from '../unwatchedCacheValidator.js';

type Stat = { mtime: number; size: number };
/**
 * `'throw'` is a stat that rejects as `EACCES`; `'hang'` is a stat that settles only once {@link createFakeFs}'s
 * `release` is called; `'enotdir'` is a path under one that is a file, which a stat or a listing of it rejects as
 * `ENOTDIR`
 */
type Reading = Stat | 'throw' | 'hang' | 'enotdir';

function notADirectory(): Promise<never> {
	return Promise.reject(Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }));
}

/** Files (`mtime:size` readings) and directories (their child directories) keyed by POSIX path */
function createFakeFs(): {
	files: Map<string, Reading>;
	dirs: Map<string, string[]>;
	/** The directories whose listing rejects as `EACCES`, though their stat reads */
	unlistable: Set<string>;
	/** The text of the files `readFile` reads */
	contents: Map<string, string>;
	stats: string[];
	stat: (path: string) => Promise<Stat | undefined>;
	readDirectory: (path: string) => Promise<readonly (readonly [string, number])[]>;
	readFile: (path: string) => Promise<Uint8Array | undefined>;
	/** Bumps a path's reading and its directory's, as a write by lockfile and rename, a create or a delete would */
	touch: (path: string) => void;
	/** Settles every hung stat with `reading` */
	release: (reading: Stat | undefined) => void;
	/** The most `stat` and `readDirectory` calls in flight at once, overall and by repository (the path before `/.git`) */
	maxInFlight: { overall: number; readonly byRepo: Map<string, number> };
} {
	const files = new Map<string, Reading>();
	const dirs = new Map<string, string[]>();
	const unlistable = new Set<string>();
	const contents = new Map<string, string>();
	const stats: string[] = [];
	const hung: ((reading: Stat | undefined) => void)[] = [];
	const maxInFlight = { overall: 0, byRepo: new Map<string, number>() };
	const inFlight = new Map<string, number>();
	let overall = 0;

	function track<T>(path: string, call: () => Promise<T>): Promise<T> {
		const repo = path.substring(0, path.indexOf('/.git'));
		const count = (inFlight.get(repo) ?? 0) + 1;
		inFlight.set(repo, count);
		overall++;
		maxInFlight.overall = Math.max(maxInFlight.overall, overall);
		maxInFlight.byRepo.set(repo, Math.max(maxInFlight.byRepo.get(repo) ?? 0, count));

		return call().finally(() => {
			inFlight.set(repo, (inFlight.get(repo) ?? 1) - 1);
			overall--;
		});
	}

	return {
		files: files,
		dirs: dirs,
		unlistable: unlistable,
		contents: contents,
		stats: stats,
		stat: function (path) {
			const p = normalizePath(path);
			stats.push(p);
			return track(p, () => {
				const file = files.get(p);
				if (file === 'throw') return Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
				if (file === 'hang') return new Promise<Stat | undefined>(resolve => hung.push(resolve));
				if (file === 'enotdir') return notADirectory();

				return Promise.resolve(file);
			});
		},
		readDirectory: function (path) {
			const p = normalizePath(path);
			return track(p, () => {
				if (files.get(p) === 'enotdir') return notADirectory();
				if (unlistable.has(p)) {
					return Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
				}

				const children = dirs.get(p);
				if (children == null) {
					return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
				}

				return Promise.resolve([
					...children.map(name => [name, FileType.Directory] as const),
					['.DS_Store', FileType.File] as const,
				]);
			});
		},
		readFile: function (path) {
			const content = contents.get(normalizePath(path));
			return Promise.resolve(content != null ? new TextEncoder().encode(content) : undefined);
		},
		touch: function (path) {
			for (const p of [path, path.substring(0, path.lastIndexOf('/'))]) {
				const file = files.get(p);
				const mtime = typeof file === 'object' ? file.mtime + 1 : 1;
				files.set(p, { mtime: mtime, size: 10 });
			}
		},
		release: function (reading) {
			for (const resolve of hung.splice(0)) {
				resolve(reading);
			}
		},
		maxInFlight: maxInFlight,
	};
}

/** Lets every validation whose file-system calls already settled run to its end */
function settle(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve));
}

interface Harness {
	cache: Cache;
	fs: ReturnType<typeof createFakeFs>;
	validator: UnwatchedCacheValidator;
	watched: Set<string>;
	clock: { now: number };
	/** Each `onRepositoryChanged` call, as `[repoPath, sorted changes, sorted moved worktrees]` */
	applied: () => [string, RepositoryChange[], string[] | undefined][];
	/** Each `applyLinkedWorktreeChanges` call, as `[repoPath, sorted changes]` */
	ownApplied: () => [string, RepositoryChange[]][];
	/** Validates `repoPath` and waits for it; `false` when there was nothing to wait for */
	validate: (repoPath?: string) => Promise<boolean>;
	/** Moves the clock past the window */
	advance: () => void;
}

/** A standard repository at `repoPath`, whose git dir the cache resolved */
function addRepo(cache: Cache, fs: ReturnType<typeof createFakeFs>, repoPath: string): void {
	cache.gitDir.set(repoPath, { uri: fileUri(`${repoPath}/.git`) });

	fs.dirs.set(`${repoPath}/.git/refs/heads`, []);
	fs.dirs.set(`${repoPath}/.git/refs/remotes`, []);
	fs.dirs.set(`${repoPath}/.git/refs/tags`, []);
	fs.files.set(`${repoPath}/.git`, { mtime: 1, size: 10 });
	for (const path of ['HEAD', 'logs/HEAD', 'packed-refs', 'config', 'refs/heads', 'refs/remotes', 'refs/tags']) {
		fs.files.set(`${repoPath}/.git/${path}`, { mtime: 1, size: 10 });
	}
}

/** A standard repository at `/repo`, with nothing in its git dir until a test adds it */
function createHarness(options?: {
	register?: boolean;
	timeoutMs?: number;
	maxFsThreads?: number;
	/** The folders whose worktrees core ignores */
	ignoredRoots?: readonly string[];
	/** Leaves `/repo`'s git dir for `resolveGitDir` to resolve */
	unresolved?: boolean;
	resolveGitDir?: (repoPath: string) => Promise<boolean>;
	/** In place of answering {@link ignoredRoots} */
	getIgnoredWorktreeRoots?: (repoPath: string) => Promise<readonly string[]>;
}): Harness {
	const cache = new Cache();
	if (options?.register) {
		cache.registerRepoPath(fileUri('/repo'), { uri: fileUri('/repo/.git') });
	}

	const fs = createFakeFs();
	addRepo(cache, fs, '/repo');
	if (options?.unresolved) {
		cache.gitDir.delete('/repo');
	}

	const watched = new Set<string>();
	const clock = { now: 1_000_123 };
	const validator = new UnwatchedCacheValidator({
		cache: cache,
		stat: fs.stat,
		readDirectory: fs.readDirectory,
		readFile: fs.readFile,
		getIgnoredWorktreeRoots:
			options?.getIgnoredWorktreeRoots ?? (() => Promise.resolve(options?.ignoredRoots ?? [])),
		resolveGitDir: options?.resolveGitDir,
		isWatched: p => watched.has(p),
		now: () => clock.now,
		timeoutMs: options?.timeoutMs,
		maxFsThreads: options?.maxFsThreads,
	});
	const spy = mock.method(cache, 'onRepositoryChanged');
	const ownSpy = mock.method(cache, 'applyLinkedWorktreeChanges');

	return {
		cache: cache,
		fs: fs,
		validator: validator,
		watched: watched,
		clock: clock,
		applied: () =>
			spy.mock.calls.map(c => {
				const [repoPath, changes, opts] = c.arguments;
				return [
					repoPath,
					[...changes].sort(),
					opts?.movedWorktrees ? [...opts.movedWorktrees].sort() : undefined,
				];
			}),
		ownApplied: () => ownSpy.mock.calls.map(c => [c.arguments[0], [...c.arguments[1]].sort()]),
		validate: async repoPath => {
			const validation = validator.validate(repoPath ?? '/repo');
			if (validation == null) return false;

			await validation;
			return true;
		},
		advance: () => {
			clock.now += 300;
		},
	};
}

/** An admin entry `id` in `/repo`'s git dir, of the linked worktree at `worktreePath`, which the cache never registered */
function addWorktreeEntry(h: Harness, id: string, worktreePath = `/wts/${id}`): void {
	h.fs.dirs.set('/repo/.git/worktrees', [...(h.fs.dirs.get('/repo/.git/worktrees') ?? []), id]);
	h.fs.files.set('/repo/.git/worktrees', { mtime: 1, size: 10 });
	h.fs.files.set(`/repo/.git/worktrees/${id}`, { mtime: 1, size: 10 });
	for (const path of ['HEAD', 'logs/HEAD', 'gitdir']) {
		h.fs.files.set(`/repo/.git/worktrees/${id}/${path}`, { mtime: 1, size: 10 });
	}
	h.fs.contents.set(`/repo/.git/worktrees/${id}/gitdir`, `${worktreePath}/.git\n`);
}

/** `git worktree remove` of the admin entry `id` in `/repo`'s git dir */
function removeWorktreeEntry(h: Harness, id: string): void {
	h.fs.dirs.set(
		'/repo/.git/worktrees',
		(h.fs.dirs.get('/repo/.git/worktrees') ?? []).filter(name => name !== id),
	);
	for (const path of [...h.fs.files.keys()]) {
		if (path === `/repo/.git/worktrees/${id}` || path.startsWith(`/repo/.git/worktrees/${id}/`)) {
			h.fs.files.delete(path);
		}
	}
	h.fs.contents.delete(`/repo/.git/worktrees/${id}/gitdir`);
	h.fs.touch('/repo/.git/worktrees');
}

/** How often each path was statted */
function countStats(stats: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const path of stats) {
		counts.set(path, (counts.get(path) ?? 0) + 1);
	}
	return counts;
}

/** Registers the linked worktree at `worktreePath`, of the admin entry `id` in `/repo`'s git dir, which the cache resolved */
function registerLinkedWorktree(h: Harness, worktreePath: string, id: string): void {
	const gitDir = { uri: fileUri(`/repo/.git/worktrees/${id}`), commonUri: fileUri('/repo/.git') };
	h.cache.registerRepoPath(fileUri(worktreePath), gitDir);
	h.cache.gitDir.set(worktreePath, gitDir);
}

/** A linked worktree at `worktreePath` (admin entry `id`) of the repository at `/repo`, both registered */
function addLinkedWorktree(h: Harness, worktreePath = '/wt', id = 'wt1'): void {
	addWorktreeEntry(h, id, worktreePath);
	registerLinkedWorktree(h, worktreePath, id);
}

const allWatched = [...allWatchedRepositoryChanges].sort();
/** What a worktree's own git dir can report */
const rootReportable: RepositoryChange[] = ['cherryPick', 'head', 'heads', 'merge', 'pausedOp', 'rebase', 'revert'];

describe('UnwatchedCacheValidator', () => {
	it('reports what validating cost in its resource usage', async () => {
		const h = createHarness();
		await h.validate();
		h.advance();
		await h.validate();
		h.advance();
		h.fs.touch('/repo/.git/packed-refs');
		await h.validate();

		const usage = h.validator.getResourceUsage();
		assert.strictEqual(usage['unwatchedValidation.validations.count'], 3);
		assert.strictEqual(usage['unwatchedValidation.validationsApplied.count'], 2, 'the first, then the move');
		assert.strictEqual(usage['unwatchedValidation.waitsTimedOut.count'], 0);
		assert.strictEqual(usage['unwatchedValidation.gitDirLookups.count'], 0);
		assert.strictEqual(usage['unwatchedValidation.gitDirs.count'], 2, 'its root and common git dirs');
		assert.ok((usage['unwatchedValidation.fsCalls.count'] ?? 0) >= h.fs.stats.length, 'every stat goes through it');
		assert.strictEqual(usage['unwatchedValidation.fsCallsStuck.count'], 0);
	});

	it('applies every change a watcher reports when there is no baseline, then only what moved', async () => {
		const h = createHarness();

		assert.ok(await h.validate());
		assert.deepStrictEqual(h.applied(), [['/repo', allWatched, undefined]]);

		h.advance();
		h.fs.stats.length = 0;
		assert.ok(await h.validate());
		assert.ok(h.fs.stats.length > 0, 'stats again');
		assert.strictEqual(h.applied().length, 1, 'nothing moved, so nothing more applied');
	});

	it('reports a packed-refs rewrite as every ref kind it packs', async () => {
		const h = createHarness();
		await h.validate();

		h.advance();
		h.fs.touch('/repo/.git/packed-refs');
		await h.validate();

		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads', 'remotes', 'tags'], undefined]);
	});

	it('finds a new ref directory, and takes its baseline before the caches are read again', async () => {
		const h = createHarness();
		await h.validate();

		// `git branch feature/x`: the directory appears, which moves `refs/heads`
		h.advance();
		h.fs.dirs.set('/repo/.git/refs/heads', ['feature']);
		h.fs.dirs.set('/repo/.git/refs/heads/feature', []);
		h.fs.files.set('/repo/.git/refs/heads/feature', { mtime: 1, size: 10 });
		h.fs.touch('/repo/.git/refs/heads');
		h.fs.stats.length = 0;
		await h.validate();
		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads'], undefined]);
		assert.ok(h.fs.stats.includes('/repo/.git/refs/heads/feature'), 'the new directory is probed');

		h.advance();
		await h.validate();
		assert.strictEqual(h.applied().length, 2, 'its baseline was taken, so it reads unmoved');

		// `git branch feature/y`, which moves only the nested directory
		h.advance();
		h.fs.touch('/repo/.git/refs/heads/feature');
		await h.validate();
		assert.deepStrictEqual(h.applied()[2], ['/repo', ['heads'], undefined]);
	});

	it('reports a moved linked worktree HEAD with its admin id', async () => {
		const h = createHarness({ register: true });
		addLinkedWorktree(h);
		await h.validate();

		h.advance();
		h.fs.touch('/repo/.git/worktrees/wt1/HEAD');
		await h.validate();

		assert.deepStrictEqual(h.applied().slice(1), [
			['/repo', ['worktreeHead', 'worktrees'], ['wt1']],
			['/wt', ['head', 'heads'], undefined],
		]);
	});

	it("reports only what a linked worktree's own git dir can at its first validation, to its own entries once the common git dir holds a reading of its HEAD", async () => {
		const h = createHarness({ register: true });
		addWorktreeEntry(h, 'wt1', '/wt');
		await h.validate();

		// Registered after the main checkout's first validation, which would otherwise have taken its baseline
		registerLinkedWorktree(h, '/wt', 'wt1');
		h.cache.refs.set('/repo', Promise.resolve([]));
		h.cache.branches.set('/wt', Promise.resolve({ values: [] }));
		h.cache.pausedOperationStatus.set('/wt', Promise.resolve(undefined));
		h.advance();
		await h.validate('/wt');
		assert.deepStrictEqual(h.applied(), [['/repo', allWatched, undefined]]);
		assert.deepStrictEqual(h.ownApplied(), [['/wt', rootReportable]]);
		assert.ok(h.cache.refs.has('/repo'), 'the shared entries');
		assert.strictEqual(h.cache.branches.has('/wt'), false, 'its copy of them, which marks its branch current');
		assert.strictEqual(h.cache.pausedOperationStatus.has('/wt'), false, 'and its own entries');
	});

	it("keeps the shared entries a sibling's watcher covers at a linked worktree's first validation", async () => {
		const h = createHarness({ register: true });
		addLinkedWorktree(h);
		h.watched.add('/repo');
		h.cache.tags.set('/repo', Promise.resolve({ values: [] }));
		h.cache.remotes.set('/repo', Promise.resolve([]));

		await h.validate('/wt');
		assert.deepStrictEqual(h.applied(), [['/wt', rootReportable, undefined]]);
		assert.ok(h.cache.tags.has('/repo'), 'the tags');
		assert.ok(h.cache.remotes.has('/repo'), 'the remotes');
	});

	it('stats nothing for a watched repository', () => {
		const h = createHarness({ register: true });
		addLinkedWorktree(h);

		h.watched.add('/repo');
		assert.strictEqual(h.validator.validate('/repo'), undefined);
		assert.strictEqual(h.fs.stats.length, 0);
	});

	it("clears only an unwatched worktree's own entries for a common move while a sibling's watcher covers it", async () => {
		const h = createHarness({ register: true });
		addLinkedWorktree(h);
		h.watched.add('/repo');
		await h.validate('/wt');
		const applied = h.applied().length;

		const spy = mock.method(h.cache, 'applyRepositoryChanges');
		h.advance();
		h.fs.touch('/repo/.git/packed-refs');
		await h.validate('/wt');

		assert.strictEqual(h.applied().length, applied, "the sibling's watcher already cleared the shared entries");
		assert.deepStrictEqual(
			spy.mock.calls.map(c => [c.arguments[0], [...c.arguments[1]].sort(), c.arguments[3]?.worktreeOnly]),
			[['/wt', ['heads', 'remotes', 'tags'], true]],
		);
	});

	it('serves a target validated within the window as is', async () => {
		const h = createHarness();
		await h.validate();

		h.clock.now += 100;
		h.fs.stats.length = 0;
		assert.strictEqual(h.validator.validate('/repo'), undefined);
		assert.deepStrictEqual(h.fs.stats, []);

		h.clock.now += 200;
		assert.ok(await h.validate());
		assert.ok(h.fs.stats.length > 0);
	});

	it('validates again once the clock was set back past the last validation', async () => {
		const h = createHarness();
		await h.validate();

		h.clock.now -= 60_000;
		h.fs.touch('/repo/.git/packed-refs');
		assert.ok(await h.validate());
		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads', 'remotes', 'tags'], undefined]);
	});

	it("applies a common move left to a sibling's watcher as that watcher leaves", async () => {
		const h = createHarness({ register: true });
		addLinkedWorktree(h);
		await h.validate();
		h.watched.add('/wt');
		const applied = h.applied().length;

		h.advance();
		h.fs.touch('/repo/.git/packed-refs');
		await h.validate();
		assert.strictEqual(h.applied().length, applied, 'left to the watcher while it watches');

		// Its last subscriber left before its debounce reported the move, after the worktree was unregistered
		h.cache.unregisterRepoPath('/wt');
		h.watched.delete('/wt');
		h.validator.onUnwatched('/wt');
		assert.deepStrictEqual(
			h.applied().at(-1),
			['/repo', ['heads', 'remotes', 'tags'], undefined],
			'to the common path, which keys the shared entries',
		);

		h.validator.onUnwatched('/wt');
		assert.strictEqual(h.applied().length, applied + 1, 'applied once');
	});

	it('leaves nothing to a sibling whose watcher attached while the common git dir was being read', async () => {
		const h = createHarness({ register: true });
		addLinkedWorktree(h);
		await h.validate();
		h.cache.tags.set('/repo', Promise.resolve({ values: [] }));
		h.cache.bestRemotes.set('/wt', Promise.resolve([]));

		h.advance();
		h.fs.touch('/repo/.git/packed-refs');
		const validation = h.validator.validate('/repo');
		assert.ok(validation != null);
		// Its own validation reads after this one, so finds the common git dir unmoved, and its watcher reports only
		// what changes from now on
		h.watched.add('/wt');
		h.validator.onWatched('/wt');
		await validation;
		await h.validator.validate('/wt');

		assert.ok(
			h.applied().some(([path, changes]) => path === '/repo' && changes.join() === 'heads,remotes,tags'),
			'applied to the shared entries',
		);
		assert.strictEqual(h.cache.tags.has('/repo'), false, 'the tags');
		assert.strictEqual(h.cache.bestRemotes.has('/wt'), false, "and the sibling's own entries");

		h.watched.delete('/wt');
		const applied = h.applied().length;
		h.validator.onUnwatched('/wt');
		assert.strictEqual(h.applied().length, applied, 'with nothing left to it');
	});

	it("clears a still-registered sibling's own entries for a common move left to its watcher as it leaves", async () => {
		const h = createHarness({ register: true });
		addLinkedWorktree(h);
		await h.validate();
		h.watched.add('/wt');
		h.cache.bestRemotes.set('/wt', Promise.resolve([]));

		// `git remote add`
		h.advance();
		h.fs.touch('/repo/.git/config');
		await h.validate();
		assert.ok(h.cache.bestRemotes.has('/wt'), 'left to the watcher while it watches');

		// Its last subscriber left before its debounce reported the move
		h.watched.delete('/wt');
		h.validator.onUnwatched('/wt');
		assert.strictEqual(h.cache.bestRemotes.has('/wt'), false);
	});

	it("applies a common move left to a sibling's watcher once that watcher is suspended, which announces nothing", async () => {
		const h = createHarness({ register: true });
		addLinkedWorktree(h);
		await h.validate();
		h.watched.add('/wt');
		const applied = h.applied().length;

		h.advance();
		h.fs.touch('/repo/.git/packed-refs');
		await h.validate();
		assert.strictEqual(h.applied().length, applied, 'left to the watcher while it watches');
		h.cache.tags.set('/repo', Promise.resolve({ values: [] }));
		h.cache.bestRemotes.set('/wt', Promise.resolve([]));

		// Suspended before its debounce reported the move, so it holds it until it resumes
		h.watched.delete('/wt');
		h.advance();
		await h.validate();
		assert.deepStrictEqual(h.applied().at(-1), ['/repo', ['heads', 'remotes', 'tags'], undefined]);
		assert.strictEqual(h.cache.tags.has('/repo'), false, 'the shared entries');
		assert.strictEqual(h.cache.bestRemotes.has('/wt'), false, "and the sibling's own entries");

		h.advance();
		await h.validate();
		h.validator.onUnwatched('/wt');
		assert.strictEqual(h.applied().length, applied + 1, 'applied once');
	});

	it('reads a path under a ref directory replaced by a ref of its name as gone, not as a failed read', async () => {
		const h = createHarness();
		h.fs.dirs.set('/repo/.git/refs/heads', ['feature']);
		h.fs.dirs.set('/repo/.git/refs/heads/feature', ['sub']);
		h.fs.dirs.set('/repo/.git/refs/heads/feature/sub', []);
		h.fs.files.set('/repo/.git/refs/heads/feature', { mtime: 1, size: 10 });
		h.fs.files.set('/repo/.git/refs/heads/feature/sub', { mtime: 1, size: 10 });
		await h.validate();

		// `git branch -D feature/sub/x && git branch feature`
		h.advance();
		h.fs.dirs.set('/repo/.git/refs/heads', []);
		h.fs.dirs.delete('/repo/.git/refs/heads/feature');
		h.fs.dirs.delete('/repo/.git/refs/heads/feature/sub');
		h.fs.files.set('/repo/.git/refs/heads/feature', { mtime: 2, size: 41 });
		h.fs.files.set('/repo/.git/refs/heads/feature/sub', 'enotdir');
		h.fs.touch('/repo/.git/refs/heads');
		await h.validate();

		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads'], undefined]);
	});

	it('reports a replace ref created or deleted as a heads change', async () => {
		const h = createHarness();
		await h.validate();

		h.advance();
		h.fs.files.set('/repo/.git/refs/replace', { mtime: 1, size: 10 });
		await h.validate();

		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads'], undefined]);
	});

	it('shares one validation between concurrent reads', async () => {
		const h = createHarness();

		const first = h.validator.validate('/repo');
		const second = h.validator.validate('/repo');
		assert.ok(first != null && second != null);
		await Promise.all([first, second]);

		assert.strictEqual(h.applied().length, 1);
	});

	it('reads nothing for a repository whose git dir the cache never resolved', () => {
		const h = createHarness();

		assert.strictEqual(h.validator.validate('/other'), undefined);
		assert.deepStrictEqual(h.fs.stats, []);
	});

	it('validates as a watcher attaches, and reads wait for it though the repository is now watched', async () => {
		const h = createHarness();
		await h.validate();

		// Within the window, which the handoff ignores
		h.fs.touch('/repo/.git/logs/HEAD');
		h.watched.add('/repo');
		h.validator.onWatched('/repo');

		const validation = h.validator.validate('/repo');
		assert.ok(validation != null);
		assert.strictEqual(h.validator.validate('/repo'), validation);
		await validation;

		assert.deepStrictEqual(h.applied()[1], ['/repo', ['head', 'heads'], undefined]);
		assert.strictEqual(h.validator.validate('/repo'), undefined, 'watched once the handoff settled');
	});

	it('counts a racy reading as moved at its next read', async () => {
		const h = createHarness();
		// Whole seconds, written (by rename, which moves the git dir too) just before the stat
		h.fs.files.set('/repo/.git/packed-refs', { mtime: 1_000_000, size: 10 });
		h.fs.files.set('/repo/.git', { mtime: 1_000_000, size: 10 });
		await h.validate();

		h.advance();
		await h.validate();
		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads', 'remotes', 'tags'], undefined]);

		// Past the racy window, the reading is trusted from here on
		h.clock.now += 5_000;
		await h.validate();
		h.advance();
		await h.validate();
		assert.strictEqual(h.applied().length, 3);
	});

	it('stops counting a reading as racy once its second ended on our clock, whatever its mtime says', async () => {
		const h = createHarness();
		// A whole-second file system whose server clock runs far ahead of ours
		const ahead = Math.ceil(h.clock.now / 1000) * 1000 + 10_000;
		h.fs.files.set('/repo/.git/packed-refs', { mtime: ahead, size: 10 });
		h.fs.files.set('/repo/.git', { mtime: ahead, size: 10 });
		await h.validate();

		h.advance();
		await h.validate();
		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads', 'remotes', 'tags'], undefined], 'racy at first');

		// Past the second it was first seen in, the reading is trusted, after the move to its plain reading
		h.clock.now += 2_000;
		await h.validate();
		const applied = h.applied().length;
		for (let i = 0; i < 5; i++) {
			h.advance();
			await h.validate();
		}
		assert.strictEqual(h.applied().length, applied, 'nothing moved while the files held still');

		// A write the next second ahead is a new reading, racy in turn
		h.advance();
		h.fs.files.set('/repo/.git/packed-refs', { mtime: ahead + 1000, size: 10 });
		h.fs.files.set('/repo/.git', { mtime: ahead + 1000, size: 10 });
		await h.validate();
		assert.strictEqual(h.applied().length, applied + 1);
		h.advance();
		await h.validate();
		assert.strictEqual(h.applied().length, applied + 2, 'racy again');
	});

	it('reports a path that becomes unreadable as moved, nothing while it stays so, and moved again once it reads', async () => {
		const h = createHarness();
		await h.validate();

		// `git pack-refs`, after which the file can't be read
		h.advance();
		h.fs.touch('/repo/.git/packed-refs');
		h.fs.files.set('/repo/.git/packed-refs', 'throw');
		await h.validate();
		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads', 'remotes', 'tags'], undefined]);

		// An index write, which moves the git dir, so the files behind it are read again
		h.advance();
		h.fs.touch('/repo/.git/index');
		h.fs.stats.length = 0;
		await h.validate();
		assert.ok(h.fs.stats.includes('/repo/.git/packed-refs'), 'read again');
		assert.strictEqual(h.applied().length, 2, 'still unreadable, so unmoved');

		h.advance();
		h.fs.files.set('/repo/.git/packed-refs', { mtime: 1, size: 10 });
		h.fs.touch('/repo/.git/index');
		await h.validate();
		assert.deepStrictEqual(h.applied()[2], ['/repo', ['heads', 'remotes', 'tags'], undefined]);
		assert.strictEqual(h.applied().length, 3);
	});

	it('lists a ref directory that could not be listed again at the next validation, keeping what it held', async () => {
		const h = createHarness();
		h.fs.dirs.set('/repo/.git/refs/heads', ['old']);
		h.fs.dirs.set('/repo/.git/refs/heads/old', []);
		h.fs.files.set('/repo/.git/refs/heads/old', { mtime: 1, size: 10 });
		await h.validate();

		// `git branch feature/x`, as `refs/heads` stops being listable
		h.advance();
		h.fs.unlistable.add('/repo/.git/refs/heads');
		h.fs.dirs.set('/repo/.git/refs/heads', ['old', 'feature']);
		h.fs.dirs.set('/repo/.git/refs/heads/feature', []);
		h.fs.files.set('/repo/.git/refs/heads/feature', { mtime: 1, size: 10 });
		h.fs.touch('/repo/.git/refs/heads');
		await h.validate();
		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads'], undefined]);

		// `git branch old/y`, which moves only the directory it already held
		h.advance();
		h.fs.files.set('/repo/.git/refs/heads/old', { mtime: 2, size: 10 });
		await h.validate();
		assert.deepStrictEqual(h.applied()[2], ['/repo', ['heads'], undefined]);

		h.advance();
		h.fs.unlistable.delete('/repo/.git/refs/heads');
		h.fs.stats.length = 0;
		await h.validate();
		assert.strictEqual(h.applied().length, 3, 'what it finds takes a baseline');
		assert.ok(h.fs.stats.includes('/repo/.git/refs/heads/feature'), 'once it is listed');

		// `git branch feature/sub/x`, which moves only the directory it found
		h.advance();
		h.fs.dirs.set('/repo/.git/refs/heads/feature', ['sub']);
		h.fs.dirs.set('/repo/.git/refs/heads/feature/sub', []);
		h.fs.files.set('/repo/.git/refs/heads/feature/sub', { mtime: 1, size: 10 });
		h.fs.files.set('/repo/.git/refs/heads/feature', { mtime: 2, size: 10 });
		await h.validate();
		assert.deepStrictEqual(h.applied()[3], ['/repo', ['heads'], undefined]);
	});

	it('takes the baselines of ref directories nested deeper than one validation lists in the validations after it', async () => {
		const h = createHarness();
		let deepest = '/repo/.git/refs/heads';
		for (let i = 0; i < 20; i++) {
			h.fs.dirs.set(deepest, ['a']);
			deepest = `${deepest}/a`;
			h.fs.dirs.set(deepest, []);
			h.fs.files.set(deepest, { mtime: 1, size: 10 });
		}
		await h.validate();
		assert.deepStrictEqual(h.applied(), [['/repo', allWatched, undefined]]);

		for (let i = 0; i < 2; i++) {
			h.advance();
			await h.validate();
		}
		assert.strictEqual(h.applied().length, 1, 'nothing moved');

		h.advance();
		h.fs.stats.length = 0;
		await h.validate();
		assert.ok(h.fs.stats.includes(deepest), 'the deepest is probed');

		// A branch created in the deepest directory, which moves only it
		h.advance();
		h.fs.files.set(deepest, { mtime: 2, size: 10 });
		await h.validate();
		assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads'], undefined]);
	});

	it('drops the cached remotes when the config moves', async () => {
		const h = createHarness();
		h.cache.setReadValidator(p => h.validator.validate(p));
		let reads = 0;
		const read = () =>
			h.cache.getRemotes('/repo', () => {
				reads++;
				return [];
			});

		await read();
		h.advance();
		await read();
		assert.strictEqual(reads, 1);

		h.advance();
		h.fs.touch('/repo/.git/config');
		await read();
		assert.strictEqual(reads, 2);
		assert.deepStrictEqual(h.applied().at(-1), ['/repo', ['config', 'remotes'], undefined]);
	});

	it("drops a linked worktree's paused operation when it starts rebasing", async () => {
		const h = createHarness({ register: true });
		addLinkedWorktree(h);
		await h.validate('/wt');

		h.cache.pausedOperationStatus.set('/wt', Promise.resolve(undefined));
		h.advance();
		h.fs.files.set('/repo/.git/worktrees/wt1/rebase-merge', { mtime: 1, size: 10 });
		await h.validate('/wt');

		assert.deepStrictEqual(h.applied().at(-1), ['/wt', ['pausedOp', 'rebase'], undefined]);
		assert.strictEqual(h.cache.pausedOperationStatus.has('/wt'), false);
	});

	it('reports a stash entry dropped below the newest, which rewrites only its reflog', async () => {
		const h = createHarness();
		h.fs.files.set('/repo/.git/refs/stash', { mtime: 1, size: 10 });
		h.fs.files.set('/repo/.git/logs/refs/stash', { mtime: 1, size: 300 });
		await h.validate();

		h.advance();
		h.fs.files.set('/repo/.git/logs/refs/stash', { mtime: 2, size: 200 });
		await h.validate();

		assert.deepStrictEqual(h.applied()[1], ['/repo', ['stash'], undefined]);
	});

	describe('behind a gate', () => {
		it("reads a gated file once its gate moves, however many validations skipped it, as the gate's own baseline", async () => {
			const h = createHarness();
			await h.validate();

			for (let i = 0; i < 2; i++) {
				h.advance();
				h.fs.stats.length = 0;
				await h.validate();
				assert.ok(!h.fs.stats.includes('/repo/.git/packed-refs'), 'skipped while the git dir holds still');
			}
			assert.strictEqual(h.applied().length, 1);

			// `git pack-refs`, which renames `packed-refs` into place
			h.advance();
			h.fs.touch('/repo/.git/packed-refs');
			await h.validate();
			assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads', 'remotes', 'tags'], undefined]);
		});

		it('stats less on an idle validation', async () => {
			async function countIdleStats(worktrees: number): Promise<number> {
				const h = createHarness();
				h.fs.dirs.set('/repo/.git/refs/heads', ['feature', 'fix']);
				h.fs.dirs.set('/repo/.git/refs/heads/feature', []);
				h.fs.dirs.set('/repo/.git/refs/heads/fix', []);
				h.fs.dirs.set('/repo/.git/refs/remotes', ['origin']);
				h.fs.dirs.set('/repo/.git/refs/remotes/origin', []);
				for (const path of ['refs/heads/feature', 'refs/heads/fix', 'refs/remotes/origin']) {
					h.fs.files.set(`/repo/.git/${path}`, { mtime: 1, size: 10 });
				}
				for (let i = 0; i < worktrees; i++) {
					addWorktreeEntry(h, `wt${i}`);
				}
				await h.validate();
				h.advance();
				await h.validate();

				h.advance();
				h.fs.stats.length = 0;
				await h.validate();
				assert.strictEqual(h.applied().length, 1, 'nothing moved');
				return h.fs.stats.length;
			}

			// 27 and 67 with every probe read every time
			const plain = await countIdleStats(0);
			assert.ok(plain <= 18, `a plain repository with 3 ref directories stats ${plain}`);
			const linked = await countIdleStats(10);
			assert.ok(linked <= 38, `and with 10 linked worktrees, ${linked}`);
		});

		it('reports only the gated file that moved, not the others behind the same gate', async () => {
			const h = createHarness();
			h.fs.files.set('/repo/.git/ORIG_HEAD', { mtime: 1, size: 10 });
			await h.validate();

			h.advance();
			h.fs.stats.length = 0;
			await h.validate();
			assert.ok(!h.fs.stats.includes('/repo/.git/ORIG_HEAD'), 'skipped while the git dir holds still');

			// `git reset`, which rewrites ORIG_HEAD by rename
			h.advance();
			h.fs.touch('/repo/.git/ORIG_HEAD');
			await h.validate();
			assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads'], undefined]);
		});

		it('reports nothing for a gate that moved alone, as an index write moves it', async () => {
			const h = createHarness({ register: true });
			addLinkedWorktree(h);
			await h.validate();
			await h.validate('/wt');
			const applied = h.applied().length;

			h.advance();
			h.fs.touch('/repo/.git/index');
			h.fs.touch('/repo/.git/worktrees/wt1/index');
			h.fs.stats.length = 0;
			await h.validate();
			await h.validate('/wt');
			assert.ok(h.fs.stats.includes('/repo/.git/packed-refs'), 'the gated files are read');
			assert.strictEqual(h.applied().length, applied);
		});

		it('takes the baselines of a new linked worktree in the validation that finds it', async () => {
			const h = createHarness({ register: true });
			await h.validate();

			// `git worktree add`
			h.advance();
			addLinkedWorktree(h);
			h.fs.touch('/repo/.git/worktrees');
			await h.validate();
			assert.deepStrictEqual(h.applied().slice(1), [
				['/repo', ['worktreeHead', 'worktrees'], ['wt1']],
				['/wt', ['head', 'heads'], undefined],
			]);

			// A switch in it, which renames its HEAD into place
			h.advance();
			h.fs.touch('/repo/.git/worktrees/wt1/HEAD');
			await h.validate();
			assert.deepStrictEqual(h.applied().slice(3), [
				['/repo', ['worktreeHead', 'worktrees'], ['wt1']],
				['/wt', ['head', 'heads'], undefined],
			]);

			h.advance();
			h.fs.stats.length = 0;
			await h.validate();
			assert.strictEqual(h.applied().length, 5);
			assert.ok(!h.fs.stats.includes('/repo/.git/worktrees/wt1/HEAD'), 'skipped while its entry holds still');
		});

		it("probes a linked worktree's own reftable only in a reftable repository", async () => {
			const h = createHarness({ register: true });
			addWorktreeEntry(h, 'wt1');
			await h.validate();
			h.advance();
			h.fs.stats.length = 0;
			await h.validate();
			assert.ok(!h.fs.stats.includes('/repo/.git/worktrees/wt1/reftable/tables.list'));

			const r = createHarness({ register: true });
			r.fs.files.set('/repo/.git/reftable/tables.list', { mtime: 1, size: 10 });
			addWorktreeEntry(r, 'wt1');
			r.fs.files.set('/repo/.git/worktrees/wt1/reftable/tables.list', { mtime: 1, size: 10 });
			await r.validate();

			// A switch in it, which rewrites its tables in place of its HEAD
			r.advance();
			r.fs.touch('/repo/.git/worktrees/wt1/reftable/tables.list');
			await r.validate();
			assert.deepStrictEqual(r.applied()[1], ['/repo', ['worktreeHead', 'worktrees'], ['wt1']]);
		});

		it('stats a path the root and common git dirs share once per validation', async () => {
			const h = createHarness({ register: true });
			addLinkedWorktree(h);
			await h.validate();

			h.advance();
			h.fs.touch('/repo/.git/packed-refs');
			h.fs.stats.length = 0;
			await h.validate();
			let counts = countStats(h.fs.stats);
			assert.strictEqual(counts.get('/repo/.git'), 1);
			assert.strictEqual(counts.get('/repo/.git/reftable/tables.list'), 1);
			assert.strictEqual(counts.get('/repo/.git/packed-refs'), 1);

			// A linked worktree's root HEAD is its admin entry's in the common git dir
			h.advance();
			h.fs.touch('/repo/.git/worktrees/wt1/HEAD');
			h.fs.stats.length = 0;
			await h.validate('/wt');
			counts = countStats(h.fs.stats);
			assert.strictEqual(counts.get('/repo/.git/worktrees/wt1'), 1);
			assert.strictEqual(counts.get('/repo/.git/worktrees/wt1/HEAD'), 1);
		});
	});

	describe('with ignored worktrees', () => {
		it("reports nothing of an ignored worktree, until it's moved out of the ignored folder", async () => {
			const h = createHarness({ register: true, ignoredRoots: ['/repo/.git/sync-tools-worktrees'] });
			addWorktreeEntry(h, 'sync1', '/repo/.git/sync-tools-worktrees/sync1');
			await h.validate();

			h.advance();
			h.fs.touch('/repo/.git/worktrees/sync1/HEAD');
			h.fs.stats.length = 0;
			await h.validate();
			assert.strictEqual(h.applied().length, 1, 'its HEAD moving changes nothing cached');
			assert.ok(!h.fs.stats.includes('/repo/.git/worktrees/sync1/HEAD'), 'and is never read');

			// `git worktree move`, which rewrites `gitdir` in place
			h.advance();
			h.fs.contents.set('/repo/.git/worktrees/sync1/gitdir', '/wts/sync1/.git\n');
			h.fs.files.set('/repo/.git/worktrees/sync1/gitdir', { mtime: 2, size: 16 });
			await h.validate();
			// Never registered, so the shared entries are cleared for it through the main checkout
			assert.deepStrictEqual(h.applied().slice(1), [
				['/repo', ['worktreeHead', 'worktrees'], ['sync1']],
				['/repo', ['head', 'heads'], undefined],
			]);

			h.advance();
			h.fs.touch('/repo/.git/worktrees/sync1/HEAD');
			await h.validate();
			assert.deepStrictEqual(h.applied().slice(3), [
				['/repo', ['worktreeHead', 'worktrees'], ['sync1']],
				['/repo', ['head', 'heads'], undefined],
			]);
		});

		it('reports a worktree moved into the ignored folder, then nothing of it', async () => {
			const h = createHarness({ register: true, ignoredRoots: ['/repo/.git/sync-tools-worktrees'] });
			addWorktreeEntry(h, 'wt1');
			await h.validate();

			h.advance();
			h.fs.contents.set('/repo/.git/worktrees/wt1/gitdir', '/repo/.git/sync-tools-worktrees/wt1/.git\n');
			h.fs.files.set('/repo/.git/worktrees/wt1/gitdir', { mtime: 2, size: 40 });
			await h.validate();
			assert.deepStrictEqual(h.applied().slice(1), [
				['/repo', ['worktreeHead', 'worktrees'], ['wt1']],
				['/repo', ['head', 'heads'], undefined],
			]);

			h.advance();
			h.fs.touch('/repo/.git/worktrees/wt1/HEAD');
			await h.validate();
			assert.strictEqual(h.applied().length, 3);
		});

		it('reports nothing of an ignored worktree added or removed', async () => {
			const h = createHarness({ register: true, ignoredRoots: ['/repo/.git/sync-tools-worktrees'] });
			await h.validate();

			// `git worktree add` into the ignored folder
			h.advance();
			addWorktreeEntry(h, 'sync1', '/repo/.git/sync-tools-worktrees/sync1');
			h.fs.touch('/repo/.git/worktrees');
			await h.validate();
			assert.strictEqual(h.applied().length, 1);

			// `git worktree remove`
			h.advance();
			removeWorktreeEntry(h, 'sync1');
			await h.validate();
			assert.strictEqual(h.applied().length, 1);
		});

		it('reports only the worktrees not ignored among those added or removed', async () => {
			const h = createHarness({ register: true, ignoredRoots: ['/repo/.git/sync-tools-worktrees'] });
			addWorktreeEntry(h, 'wt1');
			await h.validate();

			h.advance();
			addWorktreeEntry(h, 'sync1', '/repo/.git/sync-tools-worktrees/sync1');
			removeWorktreeEntry(h, 'wt1');
			await h.validate();
			assert.deepStrictEqual(h.applied()[1], ['/repo', ['worktreeHead', 'worktrees'], ['wt1']]);
		});
	});

	describe('with linked worktrees added or removed', () => {
		it('reports a removed worktree by its admin id', async () => {
			const h = createHarness({ register: true });
			addWorktreeEntry(h, 'wt1');
			await h.validate();

			h.advance();
			removeWorktreeEntry(h, 'wt1');
			await h.validate();
			assert.deepStrictEqual(h.applied()[1], ['/repo', ['worktreeHead', 'worktrees'], ['wt1']]);
		});

		it('reports any worktree when the worktrees folder moved but its entries did not change', async () => {
			const h = createHarness({ register: true });
			addWorktreeEntry(h, 'wt1');
			await h.validate();

			h.advance();
			h.fs.touch('/repo/.git/worktrees');
			await h.validate();
			assert.deepStrictEqual(h.applied()[1], ['/repo', ['worktreeHead', 'worktrees'], undefined]);
		});
	});

	describe("with a linked worktree's HEAD moved where only the common git dir sees it", () => {
		/** `/repo` and its linked worktrees `/a`, `/b` and `/c` (admin entries `a`, `b` and `c`), all registered and validated */
		async function createValidated(): Promise<Harness> {
			const h = createHarness({ register: true });
			for (const id of ['a', 'b', 'c']) {
				addLinkedWorktree(h, `/${id}`, id);
			}
			await h.validate();
			h.cache.refs.set('/repo', Promise.resolve([]));
			h.advance();
			return h;
		}

		/** `git checkout` in the linked worktree of the admin entry `id`, from outside, which renames its HEAD into place */
		function checkoutIn(h: Harness, id: string): void {
			h.fs.touch(`/repo/.git/worktrees/${id}/HEAD`);
		}

		it("applies that worktree's own report in full at the main checkout's validation", async () => {
			const h = await createValidated();
			checkoutIn(h, 'a');
			await h.validate();

			assert.deepStrictEqual(h.applied().slice(1), [
				['/repo', ['worktreeHead', 'worktrees'], ['a']],
				['/a', ['head', 'heads'], undefined],
			]);
			assert.strictEqual(h.cache.refs.has('/repo'), false, 'the shared entries, which place its branch');
		});

		it("applies that worktree's own report in full at a sibling's validation", async () => {
			const h = await createValidated();
			checkoutIn(h, 'a');
			await h.validate('/b');

			assert.deepStrictEqual(h.applied().slice(1), [
				['/b', ['worktreeHead', 'worktrees'], ['a']],
				['/a', ['head', 'heads'], undefined],
			]);
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});

		it("applies that worktree's own report in full while another worktree's watcher covers the common git dir", async () => {
			const h = await createValidated();
			h.watched.add('/c');
			checkoutIn(h, 'a');
			await h.validate('/b');

			assert.deepStrictEqual(h.applied().slice(1), [['/a', ['head', 'heads'], undefined]]);
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});

		it('leaves a worktree whose own watcher covers the common git dir to report it', async () => {
			const h = await createValidated();
			h.watched.add('/a');
			checkoutIn(h, 'a');
			await h.validate('/b');

			assert.deepStrictEqual(h.applied().slice(1), []);
			assert.ok(h.cache.refs.has('/repo'));
		});

		it('applies it as the watcher it was left to leaves without reporting it', async () => {
			const h = await createValidated();
			h.watched.add('/a');
			checkoutIn(h, 'a');
			await h.validate('/b');
			const applied = h.applied().length;

			h.watched.delete('/a');
			h.validator.onUnwatched('/a');
			assert.deepStrictEqual(h.applied().slice(applied), [
				['/repo', ['worktreeHead', 'worktrees'], undefined],
				['/a', ['head', 'heads'], undefined],
			]);
			assert.strictEqual(h.cache.refs.has('/repo'), false);

			h.validator.onUnwatched('/a');
			assert.strictEqual(h.applied().length, applied + 2, 'applied once');
		});

		it('applies it to the common path as the watcher it was left to leaves, once that worktree was unregistered', async () => {
			const h = await createValidated();
			h.watched.add('/a');
			checkoutIn(h, 'a');
			await h.validate('/b');
			const applied = h.applied().length;

			h.cache.unregisterRepoPath('/a');
			h.watched.delete('/a');
			h.validator.onUnwatched('/a');
			assert.deepStrictEqual(h.applied().slice(applied), [
				['/repo', ['worktreeHead', 'worktrees'], undefined],
				['/repo', ['head', 'heads'], undefined],
			]);
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});

		it('applies it once the watcher it was left to is suspended, which announces nothing', async () => {
			const h = await createValidated();
			h.watched.add('/a');
			checkoutIn(h, 'a');
			await h.validate('/b');
			const applied = h.applied().length;

			h.watched.delete('/a');
			h.advance();
			await h.validate('/b');
			assert.deepStrictEqual(h.applied().slice(applied), [
				['/repo', ['worktreeHead', 'worktrees'], undefined],
				['/a', ['head', 'heads'], undefined],
			]);
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});

		it("leaves nothing of a HEAD to a watcher whose own HEAD didn't move", async () => {
			const h = await createValidated();
			h.watched.add('/a');
			checkoutIn(h, 'b');
			await h.validate('/c');
			assert.deepStrictEqual(h.applied().slice(1), [['/b', ['head', 'heads'], undefined]]);
			const applied = h.applied().length;

			h.watched.delete('/a');
			h.validator.onUnwatched('/a');
			assert.deepStrictEqual(h.applied().slice(applied), [['/repo', ['worktreeHead', 'worktrees'], undefined]]);
		});

		it('applies it once to the worktree validated, when that is the worktree whose HEAD moved', async () => {
			const h = await createValidated();
			checkoutIn(h, 'a');
			await h.validate('/a');

			assert.deepStrictEqual(
				h.applied().slice(1),
				[['/a', ['head', 'heads', 'worktreeHead', 'worktrees'], ['a']]],
				'its own git dir saw it too',
			);
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});

		it('applies it to the worktree validated for a worktree never registered', async () => {
			const h = createHarness({ register: true });
			addLinkedWorktree(h, '/a', 'a');
			addWorktreeEntry(h, 'u');
			await h.validate();

			h.advance();
			checkoutIn(h, 'u');
			await h.validate('/a');
			assert.deepStrictEqual(h.applied().slice(1), [
				['/a', ['worktreeHead', 'worktrees'], ['u']],
				['/a', ['head', 'heads'], undefined],
			]);
		});

		it('applies it once to the worktree validated when it names no worktree', async () => {
			const h = await createValidated();
			h.fs.touch('/repo/.git/worktrees');
			await h.validate();

			assert.deepStrictEqual(h.applied().slice(1), [
				['/repo', ['worktreeHead', 'worktrees'], undefined],
				['/repo', ['head', 'heads'], undefined],
			]);
		});

		it("clears the shared entries once at a validation whose common git dir lost its baseline while another worktree's watcher covers it", async () => {
			let fail = false;
			const h = createHarness({
				register: true,
				getIgnoredWorktreeRoots: () => {
					if (fail) {
						fail = false;
						throw new Error('EIO');
					}
					return Promise.resolve([]);
				},
			});
			addLinkedWorktree(h, '/a', 'a');
			addLinkedWorktree(h, '/b', 'b');
			await h.validate();
			h.watched.add('/a');
			h.cache.refs.set('/repo', Promise.resolve([]));

			// `git worktree add`, whose entry fails the read of whether it is ignored, which resets the common git dir
			h.advance();
			addWorktreeEntry(h, 'c');
			h.fs.touch('/repo/.git/worktrees');
			fail = true;
			await h.validate('/b');

			assert.deepStrictEqual(h.applied().slice(1), [['/b', ['head', 'heads'], undefined]]);
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});
	});

	describe('with linked worktrees never validated', () => {
		/** `/repo` and its linked worktrees `/a`, `/b` and `/c` (admin entries `a`, `b` and `c`), all registered */
		function createWithWorktrees(): Harness {
			const h = createHarness({ register: true });
			for (const id of ['a', 'b', 'c']) {
				addLinkedWorktree(h, `/${id}`, id);
			}
			return h;
		}

		/**
		 * As {@link createWithWorktrees} (with the worktrees of `ids`), but with the worktrees registered after the main
		 * checkout's first validation, so the common git dir has its baseline and theirs are still to take
		 */
		async function createWithWorktreesAfterCommon(ids: readonly string[] = ['a', 'b', 'c']): Promise<Harness> {
			const h = createHarness({ register: true });
			for (const id of ids) {
				addWorktreeEntry(h, id, `/${id}`);
			}
			await h.validate();
			for (const id of ids) {
				registerLinkedWorktree(h, `/${id}`, id);
			}
			h.advance();
			return h;
		}

		it("takes the other worktrees' baselines at the main checkout's first validation", async () => {
			const h = createWithWorktrees();
			await h.validate();
			assert.deepStrictEqual(h.applied(), [['/repo', allWatched, undefined]]);

			// Within the window, which a baseline it never asked for doesn't open for it
			h.fs.stats.length = 0;
			assert.ok(await h.validate('/a'));
			assert.ok(h.fs.stats.length > 0, 'its own validation');
			assert.ok(
				h.fs.stats.every(p => p.startsWith('/repo/.git/worktrees/a')),
				`of its own git dir alone: ${h.fs.stats.join(', ')}`,
			);
			assert.strictEqual(h.applied().length, 1, 'from the baseline taken, so nothing moved');

			h.advance();
			for (const id of ['a', 'b', 'c']) {
				h.fs.stats.length = 0;
				assert.ok(await h.validate(`/${id}`));
				assert.ok(
					!h.fs.stats.includes(`/repo/.git/worktrees/${id}/HEAD`),
					`${id} reads as an idle baselined one`,
				);
			}
			assert.strictEqual(h.applied().length, 1, 'their baselines were taken, so nothing moved');
		});

		it("takes the other worktrees' baselines at a linked worktree's first validation", async () => {
			const h = createWithWorktrees();
			h.cache.pausedOperationStatus.set('/b', Promise.resolve(undefined));
			h.cache.pausedOperationStatus.set('/c', Promise.resolve(undefined));

			await h.validate('/a');
			assert.deepStrictEqual(h.applied(), [['/a', allWatched, undefined]], 'its own and the common report');
			assert.strictEqual(h.cache.pausedOperationStatus.has('/b'), false);
			assert.strictEqual(h.cache.pausedOperationStatus.has('/c'), false);

			h.cache.refs.set('/repo', Promise.resolve([]));
			h.advance();
			await h.validate('/b');
			await h.validate('/c');
			assert.strictEqual(h.applied().length, 1);
			assert.ok(h.cache.refs.has('/repo'), 'the shared entries read since are kept');
		});

		it("clears only the worktrees' own entries once the common git dir holds a reading of each one's HEAD, for three of them", async () => {
			const h = await createWithWorktreesAfterCommon();
			h.cache.pausedOperationStatus.set('/b', Promise.resolve(undefined));
			h.cache.pausedOperationStatus.set('/c', Promise.resolve(undefined));
			h.cache.refs.set('/repo', Promise.resolve([]));
			h.cache.branches.set('/b', Promise.resolve({ values: [] }));

			await h.validate('/a');
			assert.deepStrictEqual(h.applied().slice(1), [], 'the shared entries are left alone');
			assert.deepStrictEqual(h.ownApplied(), [
				['/a', rootReportable],
				['/b', rootReportable],
				['/c', rootReportable],
			]);
			assert.strictEqual(h.cache.pausedOperationStatus.has('/b'), false, "a sibling's own entries");
			assert.strictEqual(h.cache.pausedOperationStatus.has('/c'), false);
			assert.ok(h.cache.refs.has('/repo'), 'the shared entries');
			assert.strictEqual(h.cache.branches.has('/b'), false, "and a sibling's copy of them");

			h.cache.refs.set('/repo', Promise.resolve([]));
			h.advance();
			await h.validate('/b');
			await h.validate('/c');
			await h.validate('/repo');
			assert.strictEqual(h.applied().length, 1);
			assert.strictEqual(h.ownApplied().length, 3);
			assert.ok(h.cache.refs.has('/repo'), 'the shared entries read since are kept');
		});

		it("evicts the shared entries once, clearing each other worktree only of its own, past three worktrees' first baselines", async () => {
			const h = await createWithWorktreesAfterCommon(['a', 'b', 'c', 'd']);
			const spy = mock.method(h.cache, 'applyRepositoryChanges');

			await h.validate('/a');
			assert.deepStrictEqual(
				h
					.applied()
					.slice(1)
					.map(([path]) => path),
				['/a'],
			);
			assert.deepStrictEqual(
				spy.mock.calls
					.filter(c => c.arguments[0] !== '/a')
					.map(c => [c.arguments[0], [...c.arguments[1]].sort(), c.arguments[3]?.worktreeOnly])
					.sort(),
				[
					['/b', rootReportable, true],
					['/c', rootReportable, true],
					['/d', rootReportable, true],
				],
			);
			assert.deepStrictEqual(h.ownApplied(), []);
		});

		it("reports a HEAD move in a worktree whose baseline a sibling's validation took", async () => {
			const h = createWithWorktrees();
			await h.validate();

			// `git switch` in it
			h.advance();
			h.fs.touch('/repo/.git/worktrees/b/HEAD');
			h.fs.touch('/repo/.git/worktrees/b/logs/HEAD');
			await h.validate('/b');
			assert.deepStrictEqual(h.applied().slice(1), [
				['/b', ['head', 'heads', 'worktreeHead', 'worktrees'], ['b']],
			]);
		});

		it('clears what a HEAD move in a worktree before its baseline was taken could have left stale', async () => {
			const h = await createWithWorktreesAfterCommon();
			h.cache.worktrees.set('/repo', Promise.resolve([]));
			h.cache.branches.set('/b', Promise.resolve({ values: [] }));
			h.cache.pausedOperationStatus.set('/b', Promise.resolve(undefined));

			h.cache.refs.set('/repo', Promise.resolve([]));

			// A switch in it, which renames its HEAD into place and appends to its reflog
			h.fs.touch('/repo/.git/worktrees/b/HEAD');
			h.fs.touch('/repo/.git/worktrees/b/logs/HEAD');
			await h.validate('/a');
			assert.strictEqual(h.cache.worktrees.has('/repo'), false, 'the worktree list, which holds its branch');
			assert.strictEqual(h.cache.refs.has('/repo'), false, 'the shared entries, which place its branch');
			assert.strictEqual(h.cache.branches.has('/b'), false);
			assert.strictEqual(h.cache.pausedOperationStatus.has('/b'), false);
		});

		it('leaves a watched worktree to take its own baseline', async () => {
			const h = createWithWorktrees();
			h.watched.add('/b');
			await h.validate();
			assert.ok(!h.fs.stats.includes('/repo/.git/worktrees/b/logs/HEAD'), 'nothing of its own git dir is read');
			assert.strictEqual(
				h.validator.getResourceUsage()['unwatchedValidation.gitDirs.count'],
				4,
				'the roots of /repo, /a and /c, and the common git dir',
			);

			h.watched.delete('/b');
			h.validator.onUnwatched('/b');
			h.advance();
			await h.validate('/b');
			assert.deepStrictEqual(h.ownApplied().at(-1), ['/b', rootReportable]);
			assert.ok(!h.applied().some(([path]) => path === '/b'));
		});

		it('leaves a worktree whose git dir the cache never resolved', async () => {
			const h = createWithWorktrees();
			h.cache.gitDir.delete('/c');
			await h.validate();
			assert.ok(!h.fs.stats.includes('/repo/.git/worktrees/c/logs/HEAD'));
			assert.strictEqual(h.validator.getResourceUsage()['unwatchedValidation.gitDirs.count'], 4);
		});

		it("takes no other worktree's baseline at a validation of a worktree the cache never registered", async () => {
			const h = createWithWorktrees();
			addWorktreeEntry(h, 'u', '/u');
			h.cache.gitDir.set('/u', { uri: fileUri('/repo/.git/worktrees/u'), commonUri: fileUri('/repo/.git') });
			await h.validate('/u');
			assert.strictEqual(
				h.validator.getResourceUsage()['unwatchedValidation.gitDirs.count'],
				2,
				'its own root and common git dirs',
			);
		});

		it("takes no other worktree's baseline at a later validation of the main checkout", async () => {
			const h = createWithWorktrees();
			addWorktreeEntry(h, 'd', '/d');
			await h.validate();
			const gitDirs = h.validator.getResourceUsage()['unwatchedValidation.gitDirs.count'];

			registerLinkedWorktree(h, '/d', 'd');
			h.advance();
			await h.validate();
			assert.strictEqual(h.validator.getResourceUsage()['unwatchedValidation.gitDirs.count'], gitDirs);

			h.advance();
			await h.validate('/d');
			assert.deepStrictEqual(h.ownApplied().at(-1), ['/d', rootReportable]);
			assert.strictEqual(h.applied().length, 1);
		});

		it("validates a worktree whose baseline a sibling's validation took from that baseline as a watcher attaches", async () => {
			const h = createWithWorktrees();
			await h.validate();
			h.cache.refs.set('/repo', Promise.resolve([]));
			h.cache.branches.set('/repo', Promise.resolve({ values: [] }));

			h.watched.add('/a');
			h.validator.onWatched('/a');
			assert.ok(await h.validate('/a'));
			assert.strictEqual(h.applied().length, 1, 'nothing moved since');
			assert.ok(h.cache.refs.has('/repo'), 'so the shared entries read since are kept');
			assert.ok(h.cache.branches.has('/repo'));
		});

		it("reports a HEAD move since a sibling's validation took the baseline as a watcher attaches", async () => {
			const h = createWithWorktrees();
			await h.validate();

			// `git switch` in it
			h.fs.touch('/repo/.git/worktrees/a/HEAD');
			h.watched.add('/a');
			h.validator.onWatched('/a');
			assert.ok(await h.validate('/a'));
			assert.deepStrictEqual(h.applied().slice(1), [
				['/a', ['head', 'heads', 'worktreeHead', 'worktrees'], ['a']],
			]);
		});

		it("takes the other worktrees' baselines at the first validation run as a watcher attaches", async () => {
			const h = createHarness();
			for (const id of ['a', 'b', 'c', 'd']) {
				addWorktreeEntry(h, id, `/${id}`);
			}
			for (const id of ['a', 'b', 'c']) {
				registerLinkedWorktree(h, `/${id}`, id);
			}

			h.watched.add('/a');
			h.validator.onWatched('/a');
			assert.ok(await h.validate('/a'));
			assert.deepStrictEqual(h.applied(), [['/a', allWatched, undefined]]);

			h.advance();
			await h.validate('/b');
			await h.validate('/c');
			assert.strictEqual(h.applied().length, 1, 'their baselines were taken');

			// Its watcher left, and a worktree registered since validates first: its baseline is kept, not taken again
			h.watched.delete('/a');
			h.validator.onUnwatched('/a');
			registerLinkedWorktree(h, '/d', 'd');
			const spy = mock.method(h.cache, 'applyRepositoryChanges');
			h.advance();
			await h.validate('/d');
			assert.strictEqual(h.applied().length, 1);
			assert.deepStrictEqual(h.ownApplied(), [['/d', rootReportable]]);
			assert.ok(!spy.mock.calls.some(c => c.arguments[0] === '/a'));
		});

		it('takes at most 64 baselines of other worktrees in one validation', async () => {
			const h = createHarness({ register: true });
			for (let i = 0; i < 66; i++) {
				addLinkedWorktree(h, `/wt${i}`, `wt${i}`);
			}
			await h.validate();
			assert.strictEqual(
				h.validator.getResourceUsage()['unwatchedValidation.gitDirs.count'],
				66,
				"the main checkout's root, 64 others and the common git dir",
			);

			h.advance();
			await h.validate('/wt65');
			assert.deepStrictEqual(
				h.ownApplied(),
				[
					['/wt65', rootReportable],
					['/wt64', rootReportable],
				],
				'one left out, whose validation took the rest',
			);
			h.advance();
			await h.validate('/wt64');
			assert.strictEqual(h.ownApplied().length, 2);
			assert.strictEqual(h.applied().length, 1);
		});

		it('takes only as many baselines of other worktrees as there is room for, dropping none it holds', async () => {
			const h = createWithWorktrees();
			// 512 roots at most: 510 other repositories, then the main checkout's, leave room for one
			const others = Array.from({ length: 510 }, (_, i) => `/other${i}`);
			for (const repo of others) {
				addRepo(h.cache, h.fs, repo);
			}
			for (let i = 0; i < others.length; i += 2) {
				await Promise.all(others.slice(i, i + 2).map(p => h.validate(p)));
			}
			await h.validate();
			const applied = h.applied().length;

			h.advance();
			await h.validate(others[0]);
			assert.strictEqual(h.applied().length, applied, 'the oldest kept its baseline');
			await h.validate('/a');
			assert.strictEqual(h.applied().length, applied, 'the one there was room for');
			await h.validate('/b');
			assert.deepStrictEqual(h.ownApplied().at(-1), ['/b', rootReportable], 'one left out');
			assert.strictEqual(h.applied().length, applied);
		});

		it("applies a main checkout's first report in full, though the common git dir has a baseline", async () => {
			const h = createHarness();
			addLinkedWorktree(h, '/a', 'a');
			await h.validate('/a');

			h.cache.registerRepoPath(fileUri('/repo'), { uri: fileUri('/repo/.git') });
			h.advance();
			await h.validate('/repo');
			assert.deepStrictEqual(h.applied().at(-1), ['/repo', rootReportable, undefined]);
			assert.deepStrictEqual(h.ownApplied(), []);
		});

		it('applies the first report in full of a linked worktree the cache never registered', async () => {
			const h = createHarness({ register: true });
			addWorktreeEntry(h, 'u', '/u');
			h.cache.gitDir.set('/u', { uri: fileUri('/repo/.git/worktrees/u'), commonUri: fileUri('/repo/.git') });
			await h.validate();

			h.advance();
			await h.validate('/u');
			// With its own path as its common path, as the cache keys it, whose first report comes with it
			assert.deepStrictEqual(h.applied().at(-1), ['/u', allWatched, undefined]);
			assert.deepStrictEqual(h.ownApplied(), []);
		});

		it('applies the first report in full of an ignored worktree, whose HEAD the common git dir never reads', async () => {
			const h = createHarness({ register: true, ignoredRoots: ['/repo/.git/sync-tools-worktrees'] });
			const path = '/repo/.git/sync-tools-worktrees/sync1';
			addWorktreeEntry(h, 'sync1', path);
			await h.validate();

			registerLinkedWorktree(h, path, 'sync1');
			h.advance();
			await h.validate(path);
			assert.deepStrictEqual(h.applied().at(-1), [path, rootReportable, undefined]);
			assert.deepStrictEqual(h.ownApplied(), []);
		});

		it('applies a first report in full while the common git dir has no baseline', async () => {
			let fail = false;
			const h = createHarness({
				register: true,
				getIgnoredWorktreeRoots: () => {
					if (fail) {
						fail = false;
						throw new Error('EIO');
					}
					return Promise.resolve([]);
				},
			});
			addWorktreeEntry(h, 'a', '/a');
			await h.validate();

			// `git worktree add`, whose entry fails the read of whether it is ignored, which resets the common git dir
			registerLinkedWorktree(h, '/a', 'a');
			h.advance();
			addWorktreeEntry(h, 'b');
			h.fs.touch('/repo/.git/worktrees');
			fail = true;
			await h.validate('/repo');

			// Within the window, so the common git dir isn't read again
			await h.validate('/a');
			assert.deepStrictEqual(h.applied().at(-1), ['/a', rootReportable, undefined]);
			assert.deepStrictEqual(h.ownApplied(), []);
		});

		it("applies first reports in full at a validation that takes the common git dir's first baseline", async () => {
			const h = createHarness({ register: true });
			addLinkedWorktree(h, '/a', 'a');
			await h.validate('/a');
			assert.deepStrictEqual(h.applied(), [['/a', allWatched, undefined]]);
			assert.deepStrictEqual(h.ownApplied(), []);
		});

		it('clears what a HEAD move before its first validation left stale, when it is the worktree validated', async () => {
			const h = await createWithWorktreesAfterCommon(['a']);
			h.cache.refs.set('/repo', Promise.resolve([]));

			h.fs.touch('/repo/.git/worktrees/a/HEAD');
			await h.validate('/a');
			assert.deepStrictEqual(h.ownApplied(), [['/a', rootReportable]]);
			assert.deepStrictEqual(h.applied().slice(1), [
				['/a', ['worktreeHead', 'worktrees'], ['a']],
				['/a', ['head', 'heads'], undefined],
			]);
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});

		it('clears the shared entries a HEAD move left stale in a worktree validated before its first read, as an unread entry heals at the next common validation', async () => {
			const h = await createWithWorktreesAfterCommon(['a']);
			await h.validate('/repo');

			// After the common git dir's validation, within its window
			h.fs.touch('/repo/.git/worktrees/a/HEAD');
			h.cache.refs.set('/repo', Promise.resolve([]));
			await h.validate('/a');
			assert.deepStrictEqual(h.ownApplied(), [['/a', rootReportable]]);
			assert.ok(h.cache.refs.has('/repo'), 'stale until the common git dir is read again');

			h.advance();
			await h.validate('/repo');
			assert.deepStrictEqual(h.applied().slice(-2), [
				['/repo', ['worktreeHead', 'worktrees'], ['a']],
				['/a', ['head', 'heads'], undefined],
			]);
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});

		it("takes the same route for a worktree's report after its validation failed", async () => {
			const h = await createWithWorktreesAfterCommon(['a']);
			await h.validate('/a');
			assert.deepStrictEqual(h.ownApplied(), [['/a', rootReportable]]);

			// A poll that throws, as no file-system call does, so the root target's reset
			const roots = (h.validator as unknown as { roots: Map<string, { dir: { reset: () => void } }> }).roots;
			const dir = roots.get('/a')!.dir as unknown as { poll: () => Promise<void> };
			const poll = mock.method(dir, 'poll', () => Promise.reject(new Error('EIO')), { times: 1 });
			h.advance();
			await h.validate('/a');
			assert.strictEqual(poll.mock.callCount(), 1);
			assert.deepStrictEqual(h.ownApplied().slice(1), [['/a', rootReportable]]);
			assert.strictEqual(h.applied().length, 1);
		});

		it('clears the shared entries at the first validation of a worktree whose HEAD moved while its watcher, which left without reporting it, covered the common git dir', async () => {
			const h = createWithWorktrees();
			h.watched.add('/b');
			await h.validate();
			// What was left to it applied as it leaves; it attaches again before its git dir is cached, so validates nothing
			h.watched.delete('/b');
			h.validator.onUnwatched('/b');
			const gitDir = h.cache.gitDir.get('/b');
			assert.ok(gitDir != null);
			h.cache.gitDir.delete('/b');
			h.watched.add('/b');
			h.validator.onWatched('/b');
			h.cache.gitDir.set('/b', gitDir);
			h.cache.refs.set('/repo', Promise.resolve([]));

			h.advance();
			h.fs.touch('/repo/.git/worktrees/b/HEAD');
			await h.validate();
			assert.ok(h.cache.refs.has('/repo'), 'left to its watcher');

			h.watched.delete('/b');
			h.validator.onUnwatched('/b');
			h.advance();
			await h.validate('/b');
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});
	});

	describe('without a resolved git dir', () => {
		it('resolves it, then validates as usual', async () => {
			const h = createHarness({
				unresolved: true,
				resolveGitDir: repoPath => {
					h.cache.gitDir.set(repoPath, { uri: fileUri(`${repoPath}/.git`) });
					return Promise.resolve(true);
				},
			});

			assert.ok(await h.validate());
			assert.deepStrictEqual(h.applied(), [['/repo', allWatched, undefined]], 'no baseline yet');

			h.advance();
			h.fs.touch('/repo/.git/packed-refs');
			await h.validate();
			assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads', 'remotes', 'tags'], undefined]);
		});

		it('reads nothing when its files can show none, and asks again only after a long while', async () => {
			let resolutions = 0;
			const h = createHarness({
				unresolved: true,
				resolveGitDir: () => {
					resolutions++;
					return Promise.resolve(false);
				},
			});

			assert.ok(await h.validate());
			assert.strictEqual(h.validator.validate('/repo'), undefined);
			assert.strictEqual(resolutions, 1);
			assert.deepStrictEqual(h.fs.stats, []);
			assert.deepStrictEqual(h.applied(), []);

			h.advance();
			assert.strictEqual(h.validator.validate('/repo'), undefined, 'not after the validation window');
			h.clock.now += 29_000;
			assert.strictEqual(h.validator.validate('/repo'), undefined);
			assert.strictEqual(resolutions, 1);

			h.clock.now += 1000;
			assert.ok(await h.validate());
			assert.strictEqual(resolutions, 2);
		});

		it('asks again after the window when resolving it failed', async () => {
			let resolutions = 0;
			const h = createHarness({
				unresolved: true,
				resolveGitDir: () => {
					resolutions++;
					return Promise.reject(new Error('EIO'));
				},
			});

			assert.ok(await h.validate());
			assert.strictEqual(h.validator.validate('/repo'), undefined);
			assert.strictEqual(resolutions, 1);
			assert.deepStrictEqual(h.applied(), []);

			h.advance();
			assert.ok(await h.validate());
			assert.strictEqual(resolutions, 2);
		});
	});

	describe('on a hung file system', () => {
		afterEach(() => {
			mock.timers.reset();
		});

		/** Starts validating `repoPath`, and answers whether that settled yet */
		function startValidation(h: Harness, repoPath = '/repo'): () => boolean {
			const validation = h.validator.validate(repoPath);
			assert.ok(validation != null, 'waits for a validation');

			let settled = false;
			void validation.then(() => {
				settled = true;
			});
			return () => settled;
		}

		it('serves reads as is once a hung stat outlasts the wait, and validates again once it settles', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness();
			await h.validate();

			h.advance();
			h.fs.touch('/repo/.git/packed-refs');
			h.fs.files.set('/repo/.git/packed-refs', 'hang');
			const settled = startValidation(h);
			mock.timers.tick(999);
			await settle();
			assert.strictEqual(settled(), false, 'waits for the hung stat');

			mock.timers.tick(1);
			await settle();
			assert.ok(settled(), 'served as is once the wait timed out');
			assert.strictEqual(h.applied().length, 1, 'nothing applied');

			h.advance();
			h.fs.stats.length = 0;
			assert.strictEqual(h.validator.validate('/repo'), undefined, 'no wait while the validation hangs');
			assert.deepStrictEqual(h.fs.stats, [], 'and no new stats');

			const reading = { mtime: 2, size: 10 };
			h.fs.files.set('/repo/.git/packed-refs', reading);
			h.fs.release(reading);
			await settle();
			assert.deepStrictEqual(h.applied()[1], ['/repo', ['heads', 'remotes', 'tags'], undefined]);

			h.advance();
			h.fs.stats.length = 0;
			assert.ok(await h.validate(), 'validates again');
			assert.ok(h.fs.stats.length > 0, 'stats again');
			assert.strictEqual(h.applied().length, 2, 'nothing more moved');
		});

		it('waits as long as its timeoutMs', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness({ timeoutMs: 50 });
			await h.validate();

			h.advance();
			h.fs.touch('/repo/.git/packed-refs');
			h.fs.files.set('/repo/.git/packed-refs', 'hang');
			const settled = startValidation(h);
			mock.timers.tick(49);
			await settle();
			assert.strictEqual(settled(), false);

			mock.timers.tick(1);
			await settle();
			assert.ok(settled());

			h.fs.release(undefined);
			await settle();
		});

		it('counts a wait that timed out, and a call stuck past it, in its resource usage', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness({ timeoutMs: 50 });
			await h.validate();

			h.advance();
			h.fs.touch('/repo/.git/packed-refs');
			h.fs.files.set('/repo/.git/packed-refs', 'hang');
			startValidation(h);
			await settle();
			mock.timers.tick(50);
			await settle();
			const usage = h.validator.getResourceUsage();
			assert.strictEqual(usage['unwatchedValidation.waitsTimedOut.count'], 1);
			assert.strictEqual(usage['unwatchedValidation.fsCallsStuck.count'], 1);

			h.fs.files.set('/repo/.git/packed-refs', { mtime: 2, size: 10 });
			h.fs.release({ mtime: 2, size: 10 });
			await settle();
			assert.strictEqual(h.validator.getResourceUsage()['unwatchedValidation.fsCallsStuck.count'], 0);
		});

		it('waits for a timeoutMs longer than a timer can hold, rather than not at all', async () => {
			const h = createHarness({ timeoutMs: Number.POSITIVE_INFINITY });
			await h.validate();

			h.advance();
			h.fs.touch('/repo/.git/packed-refs');
			h.fs.files.set('/repo/.git/packed-refs', 'hang');
			const timers = mock.method(globalThis, 'setTimeout');
			const settled = startValidation(h);
			await settle();
			const delays = timers.mock.calls.map(c => c.arguments[1]);
			timers.mock.restore();
			assert.strictEqual(settled(), false, 'still waits for the hung stat');
			assert.ok(delays.length > 0, 'with a timer');
			assert.ok(
				delays.every(d => d === 2 ** 31 - 1),
				`with a delay a timer keeps, as the file-system calls' timers too: ${delays.join(', ')}`,
			);

			h.fs.release(undefined);
			await settle();
			assert.ok(settled());
		});

		it('bounds the wait for the validation run as a watcher attaches', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness();
			await h.validate();

			h.fs.touch('/repo/.git/packed-refs');
			h.fs.files.set('/repo/.git/packed-refs', 'hang');
			h.watched.add('/repo');
			h.validator.onWatched('/repo');
			const settled = startValidation(h);
			mock.timers.tick(999);
			await settle();
			assert.strictEqual(settled(), false, 'waits for the handoff');

			mock.timers.tick(1);
			await settle();
			assert.ok(settled());
			assert.strictEqual(h.validator.validate('/repo'), undefined, 'watched once the handoff settled');

			h.fs.release(undefined);
			await settle();
		});

		it("never flags a newer validation as slow from a settled one's wait", async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness();
			await h.validate();

			h.clock.now += 100;
			assert.strictEqual(h.validator.validate('/repo'), undefined, 'within the window');
			mock.timers.tick(500);

			h.advance();
			h.fs.touch('/repo/.git/packed-refs');
			h.fs.files.set('/repo/.git/packed-refs', 'hang');
			const settled = startValidation(h);
			// When the first validation's wait would have timed out
			mock.timers.tick(500);
			await settle();
			assert.strictEqual(settled(), false, 'waits its own timeout');
			assert.ok(h.validator.validate('/repo') != null, 'later reads wait for it too');

			mock.timers.tick(500);
			await settle();
			assert.ok(settled());

			h.fs.release(undefined);
			await settle();
		});

		it('bounds the wait for a git dir resolution that hangs', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			let resolutions = 0;
			const h = createHarness({
				unresolved: true,
				resolveGitDir: () => {
					resolutions++;
					return new Promise<boolean>(() => {});
				},
			});

			const settled = startValidation(h);
			mock.timers.tick(999);
			await settle();
			assert.strictEqual(settled(), false, 'waits for the resolution');

			mock.timers.tick(1);
			await settle();
			assert.ok(settled(), 'served as is once the wait timed out');

			h.advance();
			assert.strictEqual(h.validator.validate('/repo'), undefined, 'no wait while the resolution hangs');
			assert.strictEqual(resolutions, 1);
		});

		it('bounds the wait for a resolution and the validation after it as one', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness({
				unresolved: true,
				resolveGitDir: repoPath => {
					h.cache.gitDir.set(repoPath, { uri: fileUri(`${repoPath}/.git`) });
					return Promise.resolve(true);
				},
			});
			h.fs.files.set('/repo/.git/packed-refs', 'hang');

			const settled = startValidation(h);
			mock.timers.tick(999);
			await settle();
			assert.strictEqual(settled(), false, 'waits for the validation');

			mock.timers.tick(1);
			await settle();
			assert.ok(settled());

			h.advance();
			assert.strictEqual(h.validator.validate('/repo'), undefined, 'no wait while that validation hangs');

			h.fs.release(undefined);
			await settle();
		});

		it("makes one file-system call at a time for a repository, across its worktrees' git dirs", async () => {
			const h = createHarness({ register: true });
			addWorktreeEntry(h, 'wt1', '/wt');
			h.fs.dirs.set('/repo/.git/refs/heads', ['feature', 'fix']);
			h.fs.dirs.set('/repo/.git/refs/heads/feature', []);
			h.fs.dirs.set('/repo/.git/refs/heads/fix', []);
			h.fs.dirs.set('/repo/.git/refs/remotes', ['origin']);
			h.fs.dirs.set('/repo/.git/refs/remotes/origin', []);
			for (const path of ['refs/heads/feature', 'refs/heads/fix', 'refs/remotes/origin']) {
				h.fs.files.set(`/repo/.git/${path}`, { mtime: 1, size: 10 });
			}
			await h.validate();

			// Registered after the main checkout's first validation, so its own is a validation of its own beside the
			// main checkout's next one
			registerLinkedWorktree(h, '/wt', 'wt1');
			h.advance();
			h.fs.stats.length = 0;
			h.fs.maxInFlight.byRepo.clear();
			assert.deepStrictEqual(await Promise.all([h.validate('/repo'), h.validate('/wt')]), [true, true]);
			assert.deepStrictEqual(h.applied().slice(1), []);
			assert.deepStrictEqual(h.ownApplied(), [['/wt', rootReportable]], 'its own validation');
			assert.ok(h.fs.stats.includes('/repo/.git/refs/heads/feature'), 'the ref directories are probed');
			assert.ok(h.fs.stats.includes('/repo/.git/worktrees/wt1/HEAD'), "and the linked worktree's git dir");
			assert.strictEqual(h.fs.maxInFlight.byRepo.get('/repo'), 1);
		});

		it('makes one file-system call at a time for a repository, through a worktree the cache never registered', async () => {
			const h = createHarness({ register: true });
			h.cache.gitDir.set('/wt', { uri: fileUri('/repo/.git/worktrees/wt1'), commonUri: fileUri('/repo/.git') });
			h.fs.dirs.set('/repo/.git/worktrees', ['wt1']);
			h.fs.files.set('/repo/.git/worktrees', { mtime: 1, size: 10 });
			h.fs.files.set('/repo/.git/worktrees/wt1', { mtime: 1, size: 10 });
			for (const path of ['HEAD', 'logs/HEAD', 'gitdir']) {
				h.fs.files.set(`/repo/.git/worktrees/wt1/${path}`, { mtime: 1, size: 10 });
			}

			assert.deepStrictEqual(await Promise.all([h.validate('/repo'), h.validate('/wt')]), [true, true]);
			assert.ok(h.fs.stats.includes('/repo/.git/worktrees/wt1/logs/HEAD'), "the worktree's own git dir is read");
			assert.strictEqual(h.fs.maxInFlight.byRepo.get('/repo'), 1);
		});

		it('makes at most two file-system calls at a time across repositories', async () => {
			const h = createHarness();
			const repos = ['/repo', '/a', '/b', '/c'];
			for (const repo of repos.slice(1)) {
				addRepo(h.cache, h.fs, repo);
			}

			assert.deepStrictEqual(await Promise.all(repos.map(p => h.validate(p))), [true, true, true, true]);
			assert.strictEqual(h.fs.maxInFlight.overall, 2);
			assert.deepStrictEqual(
				h
					.applied()
					.map(([p]) => p)
					.sort(),
				['/a', '/b', '/c', '/repo'],
			);
		});

		it('validates other repositories once two hung stats outlast timeoutMs, when allowed a third thread', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness({ maxFsThreads: 3 });
			const repos = ['/repo', '/a', '/b'];
			for (const repo of repos.slice(1)) {
				addRepo(h.cache, h.fs, repo);
			}
			await Promise.all(repos.map(p => h.validate(p)));

			h.advance();
			const hung = ['/repo', '/a'];
			for (const repo of hung) {
				h.fs.files.set(`${repo}/.git`, 'hang');
				startValidation(h, repo);
			}
			await settle();
			mock.timers.tick(1000);
			await settle();

			h.fs.touch('/b/.git/packed-refs');
			startValidation(h, '/b');
			await settle();
			assert.deepStrictEqual(h.applied().slice(repos.length), [['/b', ['heads', 'remotes', 'tags'], undefined]]);

			for (const repo of hung) {
				h.fs.files.set(`${repo}/.git`, { mtime: 1, size: 10 });
			}
			h.fs.release({ mtime: 1, size: 10 });
			await settle();
		});

		it('holds at most as many hung file-system calls as it has threads, then waits for one to return', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness({ maxFsThreads: 3 });
			const repos = ['/repo', '/a', '/b', '/c'];
			for (const repo of repos.slice(1)) {
				addRepo(h.cache, h.fs, repo);
			}
			await Promise.all(repos.map(p => h.validate(p)));

			h.advance();
			const hung = ['/repo', '/a', '/b'];
			for (const repo of hung) {
				h.fs.files.set(`${repo}/.git`, 'hang');
				startValidation(h, repo);
			}
			h.fs.stats.length = 0;
			await settle();
			assert.ok(!h.fs.stats.includes('/b/.git'), 'two at once');

			mock.timers.tick(1000);
			await settle();
			assert.ok(h.fs.stats.includes('/b/.git'), 'a third once those two outlast timeoutMs');

			mock.timers.tick(1000);
			await settle();
			h.fs.touch('/c/.git/packed-refs');
			startValidation(h, '/c');
			await settle();
			assert.ok(!h.fs.stats.some(p => p.startsWith('/c/')), 'none while three hang');

			for (const repo of hung) {
				h.fs.files.set(`${repo}/.git`, { mtime: 1, size: 10 });
			}
			h.fs.release({ mtime: 1, size: 10 });
			await settle();
			assert.deepStrictEqual(h.applied().slice(repos.length), [['/c', ['heads', 'remotes', 'tags'], undefined]]);
			assert.strictEqual(h.fs.maxInFlight.overall, 3);
		});

		it('holds at most two file-system threads by default, however long calls hang', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness();
			const repos = ['/repo', '/a', '/b'];
			for (const repo of repos.slice(1)) {
				addRepo(h.cache, h.fs, repo);
			}
			await Promise.all(repos.map(p => h.validate(p)));

			h.advance();
			const hung = ['/repo', '/a'];
			for (const repo of hung) {
				h.fs.files.set(`${repo}/.git`, 'hang');
				startValidation(h, repo);
			}
			await settle();
			mock.timers.tick(1000);
			await settle();

			h.fs.stats.length = 0;
			h.fs.touch('/b/.git/packed-refs');
			startValidation(h, '/b');
			await settle();
			assert.ok(!h.fs.stats.some(p => p.startsWith('/b/')), 'none while two hang');

			for (const repo of hung) {
				h.fs.files.set(`${repo}/.git`, { mtime: 1, size: 10 });
			}
			h.fs.release({ mtime: 1, size: 10 });
			await settle();
			assert.deepStrictEqual(h.applied().slice(repos.length), [['/b', ['heads', 'remotes', 'tags'], undefined]]);
			assert.strictEqual(h.fs.maxInFlight.overall, 2);
		});

		it('makes no other file-system call for a repository while one hangs past timeoutMs', async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness({ register: true, maxFsThreads: 3 });
			addLinkedWorktree(h);
			const repos = ['/repo', '/wt', '/a', '/b'];
			for (const repo of repos.slice(2)) {
				addRepo(h.cache, h.fs, repo);
			}
			await Promise.all(repos.map(p => h.validate(p)));
			// `/wt`'s first baseline was taken with `/repo`'s, clearing only its own entries
			const applied = h.applied().length;

			h.advance();
			const hung = ['/repo', '/a'];
			for (const repo of hung) {
				h.fs.files.set(`${repo}/.git`, 'hang');
				startValidation(h, repo);
			}
			await settle();
			mock.timers.tick(1000);
			await settle();

			// A worktree of the hung repository, whose own git dir is behind the same hung mount
			h.fs.stats.length = 0;
			const worktreeSettled = startValidation(h, '/wt');
			h.fs.touch('/b/.git/packed-refs');
			startValidation(h, '/b');
			await settle();
			assert.deepStrictEqual(h.applied().slice(applied), [['/b', ['heads', 'remotes', 'tags'], undefined]]);
			assert.ok(!h.fs.stats.some(p => p.startsWith('/repo/')), "the worktree's calls wait for the hung one");
			assert.strictEqual(worktreeSettled(), false);

			for (const repo of hung) {
				h.fs.files.set(`${repo}/.git`, { mtime: 1, size: 10 });
			}
			h.fs.release({ mtime: 1, size: 10 });
			await settle();
			assert.ok(worktreeSettled(), 'and run once it returns');
			assert.strictEqual(h.fs.maxInFlight.byRepo.get('/repo'), 1);
		});

		it("applies nothing to a worktree unregistered while a sibling's validation took its baseline", async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness({ register: true });
			addLinkedWorktree(h, '/a', 'a');
			addLinkedWorktree(h, '/b', 'b');
			const spy = mock.method(h.cache, 'applyRepositoryChanges');

			h.fs.files.set('/repo/.git', 'hang');
			const settled = startValidation(h, '/a');
			await settle();
			h.cache.unregisterRepoPath('/b');
			h.fs.files.set('/repo/.git', { mtime: 1, size: 10 });
			h.fs.release({ mtime: 1, size: 10 });
			await settle();
			assert.ok(settled());
			assert.ok(!spy.mock.calls.some(c => c.arguments[0] === '/b'));
			assert.ok(!h.applied().some(([path]) => path === '/b'));

			// Its baseline went with it, as nothing was cleared for it, so its next report is a first one
			registerLinkedWorktree(h, '/b', 'b');
			h.advance();
			await h.validator.validate('/b');
			assert.deepStrictEqual(h.ownApplied().at(-1), ['/b', rootReportable]);
			assert.ok(!h.applied().some(([path]) => path === '/b'));
		});

		it("joins a sibling's validation that is taking a worktree's baseline", async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness({ register: true });
			addLinkedWorktree(h, '/a', 'a');
			addLinkedWorktree(h, '/b', 'b');

			h.fs.files.set('/repo/.git', 'hang');
			const settledA = startValidation(h, '/a');
			await settle();
			const settledB = startValidation(h, '/b');
			h.fs.files.set('/repo/.git', { mtime: 1, size: 10 });
			h.fs.release({ mtime: 1, size: 10 });
			await settle();
			assert.ok(settledA() && settledB());
			assert.strictEqual(countStats(h.fs.stats).get('/repo/.git/worktrees/b/logs/HEAD'), 1);
			assert.deepStrictEqual(
				h.applied().map(([path]) => path),
				['/a'],
			);
		});

		it("clears the shared entries for a sibling's baseline once the worktree that took it was unregistered, past three of them", async () => {
			mock.timers.enable({ apis: ['setTimeout'] });
			const h = createHarness({ register: true });
			const ids = ['a', 'b', 'c', 'd', 'e'];
			for (const id of ids) {
				addWorktreeEntry(h, id, `/${id}`);
			}
			await h.validate();
			for (const id of ids) {
				registerLinkedWorktree(h, `/${id}`, id);
			}
			h.cache.refs.set('/repo', Promise.resolve([]));

			h.advance();
			h.fs.files.set('/repo/.git/worktrees/a', 'hang');
			const settled = startValidation(h, '/a');
			await settle();
			h.cache.unregisterRepoPath('/a');
			h.fs.files.set('/repo/.git/worktrees/a', { mtime: 1, size: 10 });
			h.fs.release({ mtime: 1, size: 10 });
			await settle();
			assert.ok(settled());

			h.advance();
			await h.validator.validate('/b');
			assert.strictEqual(h.cache.refs.has('/repo'), false);
		});
	});
});
