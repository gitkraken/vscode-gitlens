import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { AnnouncedRepositoryChanges } from '@gitlens/git/providers/provider.js';
import type { GitService } from '@gitlens/git/service.js';
import type { WatcherRepoChangeEvent } from '@gitlens/git/watching/changeEvent.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import type { WorktreeSummary, WorktreeSummarySubscription } from '@gitlens/git/watching/worktreeSummary.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, getRepositoryKey, toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	cloneTestRepo,
	createBranch,
	createShadowCheckedGitService,
	createTestRepo,
	createWorktree,
} from './helpers.js';

const fs: FileSystemProvider = {
	readFile: async uri => readFileSync(toFsPath(uri)),
	stat: async uri => {
		try {
			const stats = statSync(toFsPath(uri));
			return {
				type: stats.isDirectory() ? 2 : 1,
				ctime: stats.ctimeMs,
				mtime: stats.mtimeMs,
				size: stats.size,
			};
		} catch {
			return undefined;
		}
	},
	readDirectory: async () => [],
};

/** The debounce every subscription here asks of the watch session, unless a suite lengthens it */
const debounceMs = 10;
/** Long enough for an event raised by a write to have been debounced, delivered and its recompute finished */
const settleMs = 150;

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, {
		cwd: cwd,
		encoding: 'utf-8',
		stdio: 'pipe',
	}).trim();
}

interface Checkout {
	readonly path: string;
	readonly key: string;
	readonly sub: WorktreeSummarySubscription;
}

/**
 * A bare `origin`, a main checkout (`main`, tracking `origin/main`) and two linked worktrees (`feature-a` tracking
 * `origin/feature-a`, `feature-b` with no upstream), each one ahead of `origin/main`. All three are registered with the
 * provider, watched by the real watch service (only the file watchers are fakes) and subscribed through
 * `WorktreeSummaryService`. `peer` is another clone of `origin`, for work that arrives by fetch.
 *
 * Every `getAheadOfBase` and `getBranch` read is counted per checkout: a summary recompute reads at least one of them,
 * so a count that stays put means the checkout was not recomputed.
 */
suite('Refreshing checkouts after writes that name the refs they moved', () => {
	let root: string;
	let origin: string;
	let main: TestRepo;
	let peer: TestRepo;
	let linked: { path: string; cleanup: () => void }[];
	let service: GitService;
	let provider: CliGitProvider;
	let watchers: { basePath: string; fire: (event: FileWatchEvent) => void }[];
	let heard: Map<string, WatcherRepoChangeEvent[]>;
	let reads: Map<string, number>;
	let mainCo: Checkout;
	let aCo: Checkout;
	let bCo: Checkout;
	let extraDisposables: { dispose(): void }[];
	let subscribeDelayMs = debounceMs;

	function repoOf(path: string) {
		const repo = service.forRepo(path);
		assert.ok(repo != null, `no repository service for ${path}`);
		return repo;
	}

	function readsOf(co: Checkout): number {
		return reads.get(co.key) ?? 0;
	}

	function heardBy(co: Checkout): WatcherRepoChangeEvent[] {
		return heard.get(co.key) ?? [];
	}

	function nextChange(co: Checkout): Promise<WorktreeSummary> {
		return new Promise(resolve => {
			const listener = co.sub.onDidChange(e => {
				listener.dispose();
				resolve(e);
			});
		});
	}

	/** Lets every pending debounce fire and every recompute it queued finish */
	async function settle(...checkouts: Checkout[]): Promise<void> {
		await delay(subscribeDelayMs + settleMs);
		await Promise.all(
			(checkouts.length ? checkouts : [mainCo, aCo, bCo]).map(co => service.summaries!.getSummary(co.path)),
		);
	}

	/** Forgets what was read and heard so far, so a test measures only the write under test */
	function resetObservations(): void {
		reads.clear();
		heard.clear();
	}

	async function track(path: string): Promise<Checkout> {
		provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
		const sub = service.summaries!.subscribe(path, {
			delayMs: subscribeDelayMs,
			workingTreeDelayMs: debounceMs,
		});
		await service.summaries!.getSummary(path);
		return { path: path, key: getRepositoryKey(path), sub: sub };
	}

	function fireWorkingTree(co: Checkout, relativePath: string): void {
		const watcher = watchers.find(w => normalizePath(w.basePath) === co.key);
		assert.ok(watcher != null, `no working tree watcher on ${co.key}`);
		watcher.fire({ path: join(co.path, relativePath), reason: 'change' });
	}

	/** Hears a checkout's repository changes the way a host subscribes to them, optionally narrowed to `relevantRefs` */
	async function listen(co: Checkout, relevantRefs?: string[]): Promise<WatcherRepoChangeEvent[]> {
		const handle = service.watchService!.watch(co.key, await provider.config.getGitDir(co.path));
		assert.ok(handle != null);
		const events: WatcherRepoChangeEvent[] = [];
		const sub = handle.session.subscribe({
			delayMs: debounceMs,
			relevantRefs: relevantRefs != null ? () => relevantRefs : undefined,
		});
		extraDisposables.push(
			sub.onDidChange(e => events.push(e)),
			sub,
			handle,
		);
		return events;
	}

	/**
	 * Reports a write to the shared `.git/config` the way the file watchers do: git writes `config.lock` and renames it
	 * over `config`
	 */
	function fireConfigChanged(): void {
		const dotGit = normalizePath(join(main.path, '.git'));
		for (const w of watchers.filter(w => normalizePath(w.basePath) === dotGit)) {
			w.fire({ path: join(w.basePath, 'config.lock'), reason: 'create' });
			w.fire({ path: join(w.basePath, 'config.lock'), reason: 'delete' });
			w.fire({ path: join(w.basePath, 'config'), reason: 'change' });
		}
	}

	/** What core announces of its own writes for `path` from now on (see `GitProvider.onDidAnnounceChanges`) */
	function announcementsFor(path: string): AnnouncedRepositoryChanges[] {
		const announced: AnnouncedRepositoryChanges[] = [];
		extraDisposables.push(
			provider.onDidAnnounceChanges(e => {
				if (normalizePath(e.repoPath) === normalizePath(path)) {
					announced.push(e);
				}
			}),
		);
		return announced;
	}

	async function localBranches(path: string): Promise<string[]> {
		return (await repoOf(path).branches.getBranches({ filter: b => !b.remote })).values.map(b => b.name).sort();
	}

	/** Advances `origin/main` (and the peer's `main`) by one commit, as another user's push would */
	function peerPushesMain(name: string): string {
		addCommit(peer.path, `${name}.txt`, name, `Peer ${name}`);
		git(peer.path, 'push', 'origin', 'main');
		return git(peer.path, 'rev-parse', 'HEAD');
	}

	setup(async () => {
		root = mkdtempSync(join(tmpdir(), 'gitlens-refresh-'));
		origin = join(root, 'origin.git');
		git(root, 'init', '--bare', '-b', 'main', origin);

		main = createTestRepo();
		git(main.path, 'remote', 'add', 'origin', origin);
		git(main.path, 'push', '-u', 'origin', 'main');
		git(main.path, 'remote', 'set-head', 'origin', 'main');

		linked = [];
		for (const name of ['feature-a', 'feature-b']) {
			createBranch(main.path, name);
			const wt = createWorktree(main.path, name);
			linked.push(wt);
			addCommit(wt.path, `${name}.txt`, name, `Work on ${name}`);
		}
		git(linked[0].path, 'push', '-u', 'origin', 'feature-a');

		peer = cloneTestRepo(origin);

		watchers = [];
		heard = new Map();
		reads = new Map();
		extraDisposables = [];
		service = createShadowCheckedGitService({
			context: { fs: fs },
			watchingProvider: {
				createWatcher: function (basePath, _pattern, onEvent) {
					watchers.push({ basePath: basePath, fire: onEvent });
					return createDisposable(() => {});
				},
			} satisfies FileWatchingProvider,
		});
		provider = service.getProvider(main.path)!.provider as CliGitProvider;

		// Counted before any repository service binds the methods
		const branches = provider.branches as unknown as Record<
			'getAheadOfBase' | 'getBranch',
			(this: unknown, repoPath: string, ...args: unknown[]) => unknown
		>;
		const count = (method: 'getAheadOfBase' | 'getBranch'): void => {
			const original = branches[method];
			branches[method] = function (repoPath, ...args) {
				reads.set(repoPath, (reads.get(repoPath) ?? 0) + 1);
				return original.call(this, repoPath, ...args);
			};
		};
		count('getAheadOfBase');
		count('getBranch');
		extraDisposables.push(
			service.watchService!.onDidChangeRepository(e => {
				const events = heard.get(e.repoPath) ?? [];
				events.push(e);
				heard.set(e.repoPath, events);
			}),
		);

		mainCo = await track(main.path);
		aCo = await track(linked[0].path);
		bCo = await track(linked[1].path);
		resetObservations();
	});

	teardown(() => {
		for (const d of extraDisposables) {
			d.dispose();
		}
		for (const co of [mainCo, aCo, bCo]) {
			co?.sub.dispose();
		}
		service.dispose();
		peer.cleanup();
		for (const wt of linked) {
			wt.cleanup();
		}
		main.cleanup();
		rmSync(root, { recursive: true, force: true });
	});

	suite('fetch', () => {
		test('moving origin/main refreshes every checkout based on it, to the new tip', async () => {
			const before = {
				a: aCo.sub.current!,
				b: bCo.sub.current!,
				main: mainCo.sub.current!,
			};
			assert.strictEqual(before.a.base?.ref, 'origin/main');
			assert.strictEqual(before.b.base?.ref, 'origin/main');

			const tip = peerPushesMain('moved');
			const changed = Promise.all([nextChange(aCo), nextChange(bCo), nextChange(mainCo)]);

			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			const [a, b, mainSummary] = await changed;

			for (const summary of [a, b]) {
				assert.strictEqual(summary.base?.ref, 'origin/main');
				assert.strictEqual(summary.base?.sha, tip, 'the base follows the new tip');
				assert.strictEqual(summary.base?.ahead, 1);
			}
			assert.strictEqual(mainSummary.behind, 1, 'main is behind its upstream, which moved');

			// The announcement names what moved, and every checkout hears it
			for (const co of [mainCo, aCo, bCo]) {
				const events = heardBy(co);
				assert.strictEqual(events.length, 1, `one event for ${co.key}`);
				assert.ok(events[0].announced.has('remotes'));
				assert.ok(events[0].mayHaveChangedRef('refs/remotes/origin/main'));
				assert.ok(!events[0].mayHaveChangedRef('refs/remotes/origin/feature-a'));
				assert.ok(!events[0].mayHaveChangedRef('refs/remotes/origin/unrelated'));
			}
		});

		test('fetching from a linked worktree refreshes the same checkouts', async () => {
			const tip = peerPushesMain('moved');
			const changed = Promise.all([nextChange(aCo), nextChange(bCo), nextChange(mainCo)]);

			await repoOf(linked[1].path).ops!.fetch({ remote: 'origin' });
			const [a, b, mainSummary] = await changed;

			assert.strictEqual(a.base?.sha, tip);
			assert.strictEqual(b.base?.sha, tip);
			assert.strictEqual(mainSummary.behind, 1);
		});

		test('a local branch a configured refspec stores into is announced by name and listed fresh', async () => {
			git(main.path, 'config', '--add', 'remote.origin.fetch', '+refs/heads/main:refs/heads/mirror');
			assert.ok(!(await localBranches(main.path)).includes('mirror'));
			assert.ok(!(await localBranches(linked[1].path)).includes('mirror'));
			const tip = peerPushesMain('mirrored');

			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			await settle();

			assert.strictEqual(git(main.path, 'rev-parse', 'refs/heads/mirror'), tip);
			for (const co of [mainCo, aCo, bCo]) {
				const events = heardBy(co);
				assert.strictEqual(events.length, 1, `one event for ${co.key}`);
				assert.ok(events[0].announced.has('heads'));
				assert.ok(events[0].mayHaveChangedRef('refs/heads/mirror'));
				assert.ok(!events[0].mayHaveChangedRef('refs/heads/feature-a'));
			}
			for (const p of [main.path, linked[1].path]) {
				const branch = (await repoOf(p).branches.getBranches({ filter: b => b.name === 'mirror' })).values[0];
				assert.strictEqual(branch?.sha, tip, `${p} lists the mirror branch at the fetched tip`);
			}
		});

		test('moving nothing announces nothing, recomputes nothing and keeps every summary as it was', async () => {
			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			await settle();
			resetObservations();
			const before = [mainCo, aCo, bCo].map(co => co.sub.current);

			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			await repoOf(main.path).ops!.fetch({ all: true });
			await repoOf(linked[0].path).ops!.fetch({ remote: 'origin' });
			await settle();

			for (const co of [mainCo, aCo, bCo]) {
				assert.deepStrictEqual(heardBy(co), [], `nothing heard by ${co.key}`);
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
			}
			assert.deepStrictEqual(
				[mainCo, aCo, bCo].map(co => co.sub.current),
				before,
			);
		});

		test('moving only a branch one checkout tracks refreshes that checkout and no other', async () => {
			git(peer.path, 'checkout', '-q', 'feature-a');
			addCommit(peer.path, 'peer-a.txt', 'a', 'Peer work on feature-a');
			git(peer.path, 'push', 'origin', 'feature-a');
			const changed = nextChange(aCo);

			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			const a = await changed;
			await settle();

			assert.strictEqual(a.behind, 1);
			assert.strictEqual(a.ahead, 0);
			assert.strictEqual(readsOf(bCo), 0, 'feature-b follows none of the moved refs');
			assert.strictEqual(readsOf(mainCo), 0, 'main follows none of the moved refs');

			// ...though each checkout still hears of the ref, for a view of remote branches to re-read
			for (const co of [mainCo, bCo]) {
				const events = heardBy(co);
				assert.strictEqual(events.length, 1, `one event for ${co.key}`);
				assert.ok(events[0].mayHaveChangedRef('refs/remotes/origin/feature-a'));
				assert.ok(!events[0].mayHaveChangedRef('refs/remotes/origin/main'));
			}
		});

		test("a new remote branch shows up in every checkout's branch list without recomputing any summary", async () => {
			const listRemote = async (path: string) =>
				(await repoOf(path).branches.getBranches({ filter: b => b.remote })).values.map(b => b.name).sort();
			assert.deepStrictEqual(await listRemote(main.path), ['origin/feature-a', 'origin/main']);
			assert.deepStrictEqual(await listRemote(linked[1].path), ['origin/feature-a', 'origin/main']);

			git(peer.path, 'push', 'origin', 'main:refs/heads/fresh');
			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			await settle();

			assert.deepStrictEqual(await listRemote(main.path), ['origin/feature-a', 'origin/fresh', 'origin/main']);
			assert.deepStrictEqual(await listRemote(linked[1].path), [
				'origin/feature-a',
				'origin/fresh',
				'origin/main',
			]);
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
			}
		});

		test('pruning a deleted remote branch drops it from the branch lists', async () => {
			git(peer.path, 'push', 'origin', 'main:refs/heads/doomed');
			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			const listRemote = async (path: string) =>
				(await repoOf(path).branches.getBranches({ filter: b => b.remote })).values.map(b => b.name).sort();
			assert.ok((await listRemote(linked[1].path)).includes('origin/doomed'));
			await settle();
			resetObservations();

			git(peer.path, 'push', 'origin', '--delete', 'doomed');
			await repoOf(main.path).ops!.fetch({ remote: 'origin', prune: true });
			await settle();

			assert.ok(!(await listRemote(main.path)).includes('origin/doomed'));
			assert.ok(!(await listRemote(linked[1].path)).includes('origin/doomed'));
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
			}
		});

		test("a fetched tag shows up in every checkout's tag list without recomputing any summary", async () => {
			const listTags = async (path: string) => (await repoOf(path).tags.getTags()).values.map(t => t.name);
			assert.deepStrictEqual(await listTags(linked[1].path), []);

			git(peer.path, 'tag', 'v1');
			git(peer.path, 'push', 'origin', 'v1');
			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			await settle();

			assert.deepStrictEqual(await listTags(main.path), ['v1']);
			assert.deepStrictEqual(await listTags(linked[1].path), ['v1']);
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
			}
		});

		test("a fetched tag that a checkout's base could resolve to is heard by it", async () => {
			// `getAheadOfBase` lists `refs/tags/main` among the refs its base depends on, though no such tag exists yet
			assert.ok(aCo.sub.current!.baseDependsOn.includes('refs/tags/main'));

			git(peer.path, 'tag', 'main');
			git(peer.path, 'push', 'origin', 'refs/tags/main');
			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			await settle();

			assert.ok(readsOf(aCo) > 0, 'feature-a re-read its base');
			assert.ok(readsOf(bCo) > 0, 'feature-b re-read its base');
		});

		test("a remote's HEAD moving to another branch at the same commit is announced by name", async () => {
			git(main.path, 'config', 'remote.origin.followRemoteHEAD', 'always');
			git(origin, 'branch', 'trunk', 'main');
			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			await settle();
			assert.strictEqual(git(main.path, 'symbolic-ref', 'refs/remotes/origin/HEAD'), 'refs/remotes/origin/main');
			const announced = announcementsFor(main.path);

			// Same commit, other branch: only the symbolic ref's target changes
			git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');
			await repoOf(main.path).ops!.fetch({ remote: 'origin' });

			assert.strictEqual(git(main.path, 'symbolic-ref', 'refs/remotes/origin/HEAD'), 'refs/remotes/origin/trunk');
			assert.deepStrictEqual(
				announced.map(a => ({ changes: a.changes, refs: a.refs })),
				[{ changes: ['remotes'], refs: ['refs/remotes/origin/HEAD'] }],
			);
		});

		test('a moved ref no announcement can name leaves the kinds seen beside it announced, unnamed', async () => {
			addCommit(peer.path, 'noted.txt', 'noted', 'Noted work');
			git(peer.path, 'tag', 'v2');
			git(peer.path, 'notes', 'add', '-m', 'a note', 'HEAD');
			git(peer.path, 'push', 'origin', 'main', 'v2', 'refs/notes/commits');
			const announced = announcementsFor(main.path);

			// The notes refspec moves `refs/notes/commits`; the tag follows the fetched commit on its own
			await repoOf(main.path).ops!.fetch({
				remote: 'origin',
				refspecs: ['+refs/notes/*:refs/notes/*', '+refs/heads/main:refs/remotes/origin/main'],
			});

			assert.strictEqual(git(main.path, 'tag', '--list', 'v2'), 'v2', 'the tag was followed');
			assert.strictEqual(announced.length, 1);
			assert.deepStrictEqual([...announced[0].changes].sort(), ['remotes', 'tags']);
			assert.strictEqual(announced[0].refs, undefined, 'any ref of those kinds may have moved');
		});

		test("a mirror's fetch, which stores into its own branches, names them", async () => {
			const mirror = join(root, 'mirror.git');
			git(root, 'clone', '-q', '--mirror', origin, mirror);
			const tip = peerPushesMain('mirrored');
			const announced = announcementsFor(mirror);

			await repoOf(mirror).ops!.fetch({ remote: 'origin' });

			assert.strictEqual(git(mirror, 'rev-parse', 'refs/heads/main'), tip);
			assert.strictEqual(announced.length, 1);
			assert.deepStrictEqual(announced[0].changes, ['heads']);
			assert.deepStrictEqual(announced[0].refs, ['refs/heads/main']);
		});

		test("a fetch from one remote reads no other remote's refs", async () => {
			git(main.path, 'remote', 'add', 'upstream', origin);
			git(main.path, 'fetch', '-q', 'upstream');
			// Fixture writes were raw, so core's caches are told
			provider.notifyChanged(main.path, ['config', 'remotes']);
			peerPushesMain('moved');
			const reads: string[][] = [];
			const run = provider.git.run.bind(provider.git);
			provider.git.run = ((options: unknown, ...args: unknown[]) => {
				// The fetch's own before-and-after reads of the refs it may write
				if (args[0] === 'for-each-ref' && args[1] === '--format=%(refname)%00%(objectname)%00%(symref)') {
					reads.push(args.filter((a): a is string => typeof a === 'string').slice(2));
				}
				return (run as (...a: unknown[]) => unknown)(options, ...args);
			}) as typeof provider.git.run;

			try {
				await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			} finally {
				provider.git.run = run;
			}

			assert.deepStrictEqual(reads, [
				['refs/tags', 'refs/remotes/origin'],
				['refs/tags', 'refs/remotes/origin'],
			]);
		});
	});

	suite('branches', () => {
		test("creating a branch updates every checkout's branch list, and no summary is recomputed for it", async () => {
			const topic = await listen(bCo, ['refs/heads/topic']);
			const other = await listen(bCo, ['refs/heads/feature-b']);
			assert.deepStrictEqual(await localBranches(main.path), ['feature-a', 'feature-b', 'main']);
			assert.deepStrictEqual(await localBranches(linked[1].path), ['feature-a', 'feature-b', 'main']);

			await repoOf(main.path).branches.createBranch!('topic', 'HEAD');
			await settle();

			assert.deepStrictEqual(await localBranches(main.path), ['feature-a', 'feature-b', 'main', 'topic']);
			assert.deepStrictEqual(await localBranches(linked[1].path), ['feature-a', 'feature-b', 'main', 'topic']);
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
				const events = heardBy(co);
				assert.strictEqual(events.length, 1);
				assert.ok(events[0].announced.has('heads'));
				assert.ok(events[0].mayHaveChangedRef('refs/heads/topic'));
				assert.ok(!events[0].mayHaveChangedRef('refs/heads/main'));
				assert.ok(!events[0].mayHaveChangedRef('refs/heads/feature-a'));
				assert.ok(!events[0].mayHaveChangedRef('refs/heads/feature-b'));
			}

			// A subscription narrowed to the new branch hears it; one narrowed to the checkout's own branch doesn't
			assert.strictEqual(topic.length, 1);
			assert.deepStrictEqual(other, []);
		});

		test("a branch a sibling's base is waiting for refreshes that sibling alone when it is created", async () => {
			await repoOf(main.path).branches.storeUserMergeTargetBranchName!('feature-b', 'release');
			await settle();
			assert.strictEqual(bCo.sub.current!.base?.ref, 'origin/main');
			assert.ok(bCo.sub.current!.baseDependsOn.includes('refs/heads/release'));
			resetObservations();
			const changed = nextChange(bCo);

			await repoOf(main.path).branches.createBranch!('release', 'main');
			const b = await changed;
			await settle();

			assert.strictEqual(b.base?.ref, 'release');
			assert.strictEqual(b.base?.tier, 'user');
			assert.strictEqual(readsOf(aCo), 0, 'feature-a does not depend on it');
			assert.strictEqual(readsOf(mainCo), 0, 'main does not depend on it');
		});

		test("deleting a branch updates every checkout's branch list", async () => {
			await repoOf(main.path).branches.createBranch!('topic', 'HEAD');
			await settle();
			resetObservations();
			const gone = await listen(bCo, ['refs/heads/topic']);
			const own = await listen(bCo, ['refs/heads/feature-b']);
			assert.deepStrictEqual(await localBranches(main.path), ['feature-a', 'feature-b', 'main', 'topic']);
			assert.deepStrictEqual(await localBranches(linked[1].path), ['feature-a', 'feature-b', 'main', 'topic']);

			await repoOf(main.path).branches.deleteLocalBranch!('topic');
			await settle();

			assert.deepStrictEqual(await localBranches(main.path), ['feature-a', 'feature-b', 'main']);
			assert.deepStrictEqual(await localBranches(linked[1].path), ['feature-a', 'feature-b', 'main']);
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
				const events = heardBy(co);
				assert.strictEqual(events.length, 1);
				assert.ok(events[0].announced.has('heads'));
				assert.ok(events[0].mayHaveChangedRef('refs/heads/topic'));
				assert.ok(!events[0].mayHaveChangedRef('refs/heads/feature-a'));
				assert.ok(!events[0].mayHaveChangedRef('refs/heads/feature-b'));
				// The delete also drops the branch's config section, and only that
				assert.ok(events[0].changed('config'));
				assert.strictEqual(events[0].configConfined, true, `${co.key} hears the config confined to topic`);
			}
			assert.strictEqual(gone.length, 1);
			assert.deepStrictEqual([...gone[0].changes].sort(), ['config', 'heads']);
			// Neither the branch nor its config section concerns a subscription following another branch
			assert.deepStrictEqual(own, []);
		});

		test('creating a branch that tracks a remote one recomputes no summary', async () => {
			const own = await listen(bCo, ['refs/heads/feature-b']);
			const created = await listen(bCo, ['refs/heads/topic']);

			await repoOf(main.path).branches.createBranch!('topic', 'origin/feature-a');
			await settle();

			assert.strictEqual(
				git(main.path, 'config', 'branch.topic.merge'),
				'refs/heads/feature-a',
				'tracking written',
			);
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed for the create`);
				const events = heardBy(co);
				assert.strictEqual(events.length, 1);
				assert.deepStrictEqual([...events[0].changes].sort(), ['config', 'heads']);
				assert.strictEqual(events[0].configConfined, true);
			}
			assert.strictEqual(created.length, 1);
			assert.ok(created[0].mayHaveChangedConfig(['refs/heads/topic']));
			assert.deepStrictEqual(own, []);
		});

		test('renaming a branch that tracks a remote one recomputes no summary', async () => {
			await repoOf(main.path).branches.createBranch!('topic', 'origin/feature-a');
			await settle();
			resetObservations();
			const own = await listen(bCo, ['refs/heads/feature-b']);
			const renamed = await listen(bCo, ['refs/heads/topic']);

			await repoOf(main.path).branches.renameBranch!('topic', 'renamed');
			await settle();

			assert.strictEqual(
				git(main.path, 'config', 'branch.renamed.merge'),
				'refs/heads/feature-a',
				'tracking moved',
			);
			assert.deepStrictEqual(await localBranches(linked[1].path), ['feature-a', 'feature-b', 'main', 'renamed']);
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed for the rename`);
				const events = heardBy(co);
				assert.strictEqual(events.length, 1);
				assert.ok(events[0].mayHaveChangedConfig(['refs/heads/topic']));
				assert.ok(events[0].mayHaveChangedConfig(['refs/heads/renamed']));
				assert.ok(!events[0].mayHaveChangedConfig(['refs/heads/feature-b']));
			}
			assert.strictEqual(renamed.length, 1, 'the subscription following the old name hears the rename');
			assert.deepStrictEqual(own, []);
		});

		test("the watcher's own report of a delete's config change recomputes nothing, however late it lands", async () => {
			await repoOf(main.path).branches.createBranch!('topic', 'origin/feature-a');
			fireConfigChanged();
			await settle();
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed for the create or its report`);
			}
			resetObservations();

			await repoOf(main.path).branches.deleteLocalBranch!('topic');
			// Once while the announcement is pending, and again after it fired
			fireConfigChanged();
			await settle();
			fireConfigChanged();
			await settle();

			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
				const events = heardBy(co);
				assert.strictEqual(events.length, 1, `${co.key} heard the announcement alone`);
				assert.strictEqual(events[0].configConfined, true);
				assert.ok(!events[0].changed('remotes'), "the report's remotes went with it");
			}
		});

		test("an outside edit to a sibling's branch config right after a delete still recomputes that sibling", async () => {
			await repoOf(main.path).branches.createBranch!('topic', 'origin/feature-a');
			await settle();
			await repoOf(main.path).branches.deleteLocalBranch!('topic');
			fireConfigChanged();
			await settle();
			resetObservations();
			assert.strictEqual(bCo.sub.current!.upstream, undefined);

			// Raw git, right after: the file changed again, in another branch's section
			git(main.path, 'config', 'branch.feature-b.remote', '.');
			git(main.path, 'config', 'branch.feature-b.merge', 'refs/heads/main');
			const changed = nextChange(bCo);
			fireConfigChanged();
			const b = await changed;
			await settle();

			assert.ok(readsOf(bCo) > 0, 'feature-b re-read its branch');
			assert.strictEqual(b.upstream?.name, 'main');
			assert.ok(heardBy(bCo).some(e => e.configBranches?.has('refs/heads/feature-b')));
			assert.strictEqual(readsOf(aCo), 0, 'feature-a follows none of it');
			assert.strictEqual(readsOf(mainCo), 0, 'main follows none of it');
		});

		test("an outside edit to a sibling's branch config recomputes that sibling alone", async () => {
			assert.strictEqual(bCo.sub.current!.upstream, undefined);

			// Raw git, which core doesn't announce: only the watcher reports it, and only that section changed
			git(main.path, 'config', 'branch.feature-b.remote', '.');
			git(main.path, 'config', 'branch.feature-b.merge', 'refs/heads/main');
			const changed = nextChange(bCo);
			fireConfigChanged();
			const b = await changed;
			await settle();

			assert.ok(readsOf(bCo) > 0, 'feature-b re-read its branch');
			assert.strictEqual(b.upstream?.name, 'main');
			for (const co of [mainCo, aCo, bCo]) {
				assert.ok(
					heardBy(co).every(e => !e.changed('remotes') && e.configBranches?.has('refs/heads/feature-b')),
					`${co.key} hears it confined to feature-b`,
				);
			}
			assert.strictEqual(readsOf(aCo), 0, 'feature-a was not recomputed');
			assert.strictEqual(readsOf(mainCo), 0, 'main was not recomputed');
		});

		test('an outside edit to a remote config recomputes every checkout', async () => {
			git(main.path, 'config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*');
			fireConfigChanged();
			await settle();

			for (const co of [mainCo, aCo, bCo]) {
				assert.ok(readsOf(co) > 0, `${co.key} re-read its config-derived fields`);
			}
		});
	});

	suite('worktrees', () => {
		test("adding a worktree with a new branch and removing it update every checkout's lists", async () => {
			const path = join(root, 'wt-c');
			const listWorktrees = async (p: string) =>
				(await repoOf(p).worktrees!.getWorktrees()).map(w => normalizePath(w.path)).sort();
			const before = (await listWorktrees(main.path)).length;
			assert.strictEqual((await listWorktrees(linked[1].path)).length, before);
			assert.strictEqual((await localBranches(linked[1].path)).includes('feature-c'), false);

			await repoOf(main.path).worktrees!.createWorktree(path, {
				createBranch: 'feature-c',
				commitish: 'main',
			});
			await settle();

			for (const p of [main.path, linked[0].path, linked[1].path]) {
				const paths = await listWorktrees(p);
				assert.strictEqual(paths.length, before + 1, `${p} lists the new worktree`);
				assert.ok(paths.includes(normalizePath(path)));
				assert.ok((await localBranches(p)).includes('feature-c'));
			}
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
				assert.ok(heardBy(co).some(e => e.mayHaveChangedRef('refs/heads/feature-c')));
				assert.ok(heardBy(co).every(e => !e.mayHaveChangedRef('refs/heads/feature-b')));
			}

			resetObservations();
			await repoOf(main.path).worktrees!.deleteWorktree(path);
			await settle();

			for (const p of [main.path, linked[0].path, linked[1].path]) {
				const paths = await listWorktrees(p);
				assert.strictEqual(paths.length, before, `${p} no longer lists the removed worktree`);
				assert.ok(!paths.includes(normalizePath(path)));
			}
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
			}
		});

		test('adding a worktree for a remote-only branch announces the local branch git creates, which tracks the remote one, and every checkout lists it', async () => {
			const path = join(root, 'wt-remote');
			git(peer.path, 'push', 'origin', 'main:refs/heads/remote-only');
			// A raw fetch, so no announcement of core's own is mixed into what is asserted below
			git(main.path, 'fetch', '-q', 'origin');
			assert.ok(!(await localBranches(main.path)).includes('remote-only'), 'only the remote branch exists');
			resetObservations();
			const announced = announcementsFor(main.path);

			await repoOf(main.path).worktrees!.createWorktree(path, { commitish: 'remote-only' });
			// The watcher's report of the tracking git wrote to `.git/config`
			fireConfigChanged();
			await settle();

			for (const p of [main.path, linked[0].path, linked[1].path]) {
				assert.ok((await localBranches(p)).includes('remote-only'), `${p} lists the new local branch`);
			}
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
				assert.ok(heardBy(co).some(e => e.mayHaveChangedRef('refs/heads/remote-only')));
				assert.ok(heardBy(co).every(e => !e.mayHaveChangedRef('refs/heads/feature-b')));
			}

			assert.strictEqual(announced.length, 1);
			assert.ok(announced[0].changes.includes('heads'));
			assert.ok(announced[0].changes.includes('worktrees'));
			assert.ok(!announced[0].changes.includes('config'), 'the config watcher reports the tracking, not core');
			assert.deepStrictEqual(announced[0].refs, ['refs/heads/remote-only']);

			const branch = await repoOf(main.path).branches.getBranch('remote-only');
			assert.strictEqual(branch?.upstream?.name, 'origin/remote-only');

			resetObservations();
			await repoOf(main.path).worktrees!.deleteWorktree(path);
			await settle();
		});

		test('an add cut short after git created the branch announces every head as possibly moved', async () => {
			const path = join(root, 'wt-cut');
			const hooks = join(main.path, '.git', 'hooks');
			const started = join(root, 'post-checkout-started');
			git(peer.path, 'push', 'origin', 'main:refs/heads/remote-cut');
			git(main.path, 'fetch', '-q', 'origin');
			// A global `core.hooksPath` would otherwise keep the hook from running, and the add would finish uncancelled
			git(main.path, 'config', 'core.hooksPath', hooks);
			// Git creates the branch, then checks it out and runs this hook, which outlasts the cancellation below.
			// It cancels only once the hook runs: an abort before the checkout finishes makes git delete the new worktree
			writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\ntouch "${normalizePath(started)}"\nsleep 5\n`, {
				mode: 0o755,
			});
			resetObservations();
			const announced = announcementsFor(main.path);

			const aborter = new AbortController();
			const adding = repoOf(main.path).worktrees!.createWorktree(
				path,
				{ commitish: 'remote-cut' },
				{ cancellation: aborter.signal },
			);
			let settled = false;
			const onSettled = (): void => {
				settled = true;
			};
			// Stops waiting, and lets the assertion below report why, if the add ends before the hook runs
			void adding.then(onSettled, onSettled);
			while (!existsSync(started) && !settled) {
				await delay(20);
			}
			aborter.abort();
			await assert.rejects(adding, ex => isCancellationError(ex));
			await settle();

			for (const p of [main.path, linked[0].path, linked[1].path]) {
				assert.ok((await localBranches(p)).includes('remote-cut'), `${p} lists the new local branch`);
			}
			assert.strictEqual(announced.length, 1);
			assert.deepStrictEqual([...announced[0].changes].sort(), ['heads', 'worktreeHead', 'worktrees']);
			assert.strictEqual(announced[0].refs, undefined, "the cancelled run's output, naming the branch, is lost");
		});

		/** Reports a worktree's HEAD file the way the `.git` watchers over the common git dir do */
		function fireWorktreeHead(id: string, reason: FileWatchEvent['reason']): void {
			const dotGit = normalizePath(join(main.path, '.git'));
			for (const w of watchers.filter(w => normalizePath(w.basePath) === dotGit)) {
				w.fire({ path: join(w.basePath, 'worktrees', id, 'HEAD'), reason: reason });
			}
		}

		function unannouncedHeard(co: Checkout): string[] {
			return heardBy(co).flatMap(e => e.getUnannouncedChanges());
		}

		test("adding and removing a worktree take the watchers' report of its HEAD for their own, in every checkout", async () => {
			const path = join(root, 'wt-head');
			resetObservations();

			await repoOf(main.path).worktrees!.createWorktree(path, { commitish: 'main', detach: true });
			fireWorktreeHead('wt-head', 'create');
			await settle();

			for (const co of [mainCo, aCo, bCo]) {
				assert.ok(
					heardBy(co).some(e => e.changed('worktreeHead')),
					`${co.key} heard the new worktree's HEAD`,
				);
				assert.deepStrictEqual(unannouncedHeard(co), [], `${co.key} heard nothing unannounced`);
			}

			resetObservations();
			await repoOf(main.path).worktrees!.deleteWorktree(path);
			fireWorktreeHead('wt-head', 'delete');
			await settle();

			for (const co of [mainCo, aCo, bCo]) {
				assert.deepStrictEqual(unannouncedHeard(co), [], `${co.key} heard nothing unannounced`);
			}
		});

		test("a checkout core runs in one worktree takes the watchers' report of its HEAD for its own, in every other checkout", async () => {
			const id = basename(git(linked[0].path, 'rev-parse', '--absolute-git-dir'));
			resetObservations();

			await repoOf(linked[0].path).ops!.checkout(git(linked[0].path, 'rev-parse', 'HEAD'));
			fireWorktreeHead(id, 'change');
			await settle();

			for (const co of [mainCo, bCo]) {
				assert.ok(
					heardBy(co).some(e => e.changed('worktreeHead')),
					`${co.key} heard the worktree's HEAD move`,
				);
				assert.deepStrictEqual(unannouncedHeard(co), [], `${co.key} heard nothing unannounced`);
			}

			await repoOf(linked[0].path).ops!.checkout('feature-a');
			await settle();
		});

		test("a lock doesn't take a sibling's HEAD moving beside it for its own", async () => {
			const id = basename(git(linked[0].path, 'rev-parse', '--absolute-git-dir'));
			resetObservations();

			await repoOf(main.path).worktrees!.lockWorktree(linked[0].path, { reason: 'task' });
			// A checkout in that worktree, outside core, as the lock lands
			fireWorktreeHead(id, 'change');
			await settle();

			for (const co of [mainCo, bCo]) {
				assert.deepStrictEqual(unannouncedHeard(co), ['worktreeHead'], `${co.key} heard the checkout`);
			}

			await repoOf(main.path).worktrees!.unlockWorktree(linked[0].path);
		});

		test('adding a worktree with no commitish announces the branch git names after the path', async () => {
			const path = join(root, 'wt-guess');
			assert.ok(!(await localBranches(main.path)).includes('wt-guess'));
			resetObservations();
			const announced = announcementsFor(main.path);

			await repoOf(main.path).worktrees!.createWorktree(path);
			await settle();

			for (const p of [main.path, linked[0].path, linked[1].path]) {
				assert.ok((await localBranches(p)).includes('wt-guess'), `${p} lists the new local branch`);
			}
			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
				assert.ok(heardBy(co).some(e => e.mayHaveChangedRef('refs/heads/wt-guess')));
				assert.ok(heardBy(co).every(e => !e.mayHaveChangedRef('refs/heads/feature-b')));
			}

			assert.strictEqual(announced.length, 1);
			assert.ok(announced[0].changes.includes('heads'));
			assert.deepStrictEqual(announced[0].refs, ['refs/heads/wt-guess']);

			resetObservations();
			await repoOf(main.path).worktrees!.deleteWorktree(path);
			await settle();
		});
	});

	suite('work in a linked worktree', () => {
		test("a commit updates that worktree's summary and the branch list every checkout reads", async () => {
			const sibling = { b: bCo.sub.current, main: mainCo.sub.current };
			const own = await listen(bCo, ['refs/heads/feature-b', 'refs/remotes/origin/main']);
			const committed = await listen(bCo, ['refs/heads/feature-a']);
			assert.strictEqual((await repoOf(main.path).branches.getBranch('feature-a'))?.sha, aCo.sub.current!.sha);
			// That read is the test's, not a recompute
			const mainReads = readsOf(mainCo);
			const changed = nextChange(aCo);

			await repoOf(linked[0].path).ops!.commit('More work', {
				allowEmpty: true,
			});
			const a = await changed;
			await settle();
			// The commit names the one branch it moved, so no other checkout recomputes
			assert.strictEqual(readsOf(bCo), 0, 'feature-b was not recomputed');
			assert.strictEqual(readsOf(mainCo), mainReads, 'main was not recomputed');

			const head = git(linked[0].path, 'rev-parse', 'HEAD');
			assert.strictEqual(a.sha, head);
			assert.strictEqual(a.base?.ahead, 2);
			assert.strictEqual(a.ahead, 1, 'one commit ahead of its upstream');
			assert.strictEqual((await repoOf(main.path).branches.getBranch('feature-a'))?.sha, head);
			assert.deepStrictEqual(bCo.sub.current, sibling.b);
			assert.deepStrictEqual(mainCo.sub.current, sibling.main);
			// ...nor hears of any branch but feature-a
			for (const co of [mainCo, bCo]) {
				const events = heardBy(co);
				assert.strictEqual(events.length, 1);
				assert.deepStrictEqual([...events[0].changes], ['heads']);
				assert.ok(events[0].mayHaveChangedRef('refs/heads/feature-a'));
				assert.ok(!events[0].mayHaveChangedRef('refs/heads/feature-b'));
				assert.ok(!events[0].mayHaveChangedRef('refs/heads/main'));
			}
			assert.deepStrictEqual(own, []);
			assert.strictEqual(committed.length, 1);
		});

		test('a commit after a switch outside core names the branch it moved, not the cached one', async () => {
			// The summary read feature-a as the current branch, and nothing told core of the switch
			assert.strictEqual(aCo.sub.current!.branch, 'feature-a');
			git(linked[0].path, 'switch', '-q', '-c', 'other');
			const announced = announcementsFor(linked[0].path);

			await repoOf(linked[0].path).ops!.commit('Work on other', { allowEmpty: true });

			assert.strictEqual(announced.length, 1);
			assert.deepStrictEqual(announced[0].refs, ['refs/heads/other']);
		});

		test('a commit on a detached HEAD moves no branch, so other checkouts hear only that its HEAD moved', async () => {
			git(linked[0].path, 'checkout', '-q', '--detach');
			// What the watchers report for the worktree's HEAD, which the fixture's fakes never fire
			provider.notifyChanged(linked[0].path, ['head', 'heads', 'worktrees']);
			await settle();
			resetObservations();
			const announced = announcementsFor(linked[0].path);
			const changed = nextChange(aCo);

			await repoOf(linked[0].path).ops!.commit('Detached work', { allowEmpty: true });
			const a = await changed;
			await settle();

			assert.strictEqual(announced.length, 1);
			assert.deepStrictEqual([...announced[0].changes], ['head', 'index', 'worktrees', 'worktreeHead']);
			assert.strictEqual(a.sha, git(linked[0].path, 'rev-parse', 'HEAD'), "the worktree's own summary moved");
			for (const co of [bCo, mainCo]) {
				assert.deepStrictEqual(
					heardBy(co).map(e => [...e.changes]),
					[['worktrees', 'worktreeHead']],
					`${co.key} heard only that the worktree's HEAD moved`,
				);
			}
			assert.strictEqual(readsOf(bCo), 0, 'feature-b was not recomputed');
		});

		test('a rebase onto a fetched origin/main moves the fork point and the head', async () => {
			const tip = peerPushesMain('moved');
			await repoOf(main.path).ops!.fetch({ remote: 'origin' });
			await settle();
			const stale = bCo.sub.current!;
			assert.strictEqual(aCo.sub.current!.base?.sha, tip);
			assert.notStrictEqual(aCo.sub.current!.base?.forkPoint, tip);
			const changed = nextChange(aCo);

			await repoOf(linked[0].path).ops!.rebase('origin/main');
			const a = await changed;
			await settle();

			assert.strictEqual(a.sha, git(linked[0].path, 'rev-parse', 'HEAD'));
			assert.strictEqual(a.base?.forkPoint, tip);
			assert.strictEqual(a.base?.ahead, 1);
			assert.strictEqual(
				a.ahead,
				2,
				'the rebased commit and the commit it was rebased onto, which feature-a lacks',
			);
			assert.strictEqual(a.behind, 1, 'the commit that was pushed before the rebase');
			assert.deepStrictEqual(bCo.sub.current, stale, 'feature-b was not rebased');
		});

		test('stashing and popping flip the dirty flag and update the stash list, and recompute no other checkout', async () => {
			const listStash = async (p: string) => [...((await repoOf(p).stash!.getStash())?.stashes.keys() ?? [])];
			assert.deepStrictEqual(await listStash(main.path), []);
			assert.deepStrictEqual(await listStash(linked[1].path), []);

			let dirty = nextChange(aCo);
			writeFileSync(join(linked[0].path, 'README.md'), '# Edited\n');
			fireWorkingTree(aCo, 'README.md');
			assert.strictEqual((await dirty).dirty, true);
			resetObservations();

			const own = await listen(bCo, ['refs/heads/feature-b']);
			const stashed = await listen(bCo, ['refs/stash']);
			dirty = nextChange(aCo);
			await repoOf(linked[0].path).stash!.saveStash('wip');
			fireWorkingTree(aCo, 'README.md');
			assert.strictEqual((await dirty).dirty, false);
			await settle();

			for (const p of [main.path, linked[0].path, linked[1].path]) {
				assert.strictEqual((await listStash(p)).length, 1, `${p} lists the stash`);
			}
			assert.strictEqual(readsOf(mainCo), 0);
			assert.strictEqual(readsOf(bCo), 0);

			resetObservations();
			dirty = nextChange(aCo);
			await repoOf(linked[0].path).stash!.applyStash('stash@{0}', {
				deleteAfter: true,
			});
			fireWorkingTree(aCo, 'README.md');
			assert.strictEqual((await dirty).dirty, true);
			await settle();

			for (const p of [main.path, linked[0].path, linked[1].path]) {
				assert.deepStrictEqual(await listStash(p), [], `${p} no longer lists the stash`);
			}
			assert.strictEqual(readsOf(mainCo), 0);
			assert.strictEqual(readsOf(bCo), 0);
			// Both writes name `refs/stash`, so only a subscription following it hears them
			assert.deepStrictEqual(own, []);
			assert.strictEqual(stashed.length, 2);
			assert.ok(stashed.every(e => e.mayHaveChangedRef('refs/stash')));
		});
	});

	suite("a branch that is a sibling's local upstream", () => {
		test('deleting and recreating it refreshes the sibling that tracks it', async () => {
			git(main.path, 'branch', 'base-local', 'main');
			git(main.path, 'branch', '--track', 'child', 'base-local');
			const wt = createWorktree(main.path, 'child');
			linked.push(wt);
			addCommit(wt.path, 'child.txt', 'child', 'Work on child');
			// Fixture writes were raw, so core's caches are told
			provider.notifyChanged(main.path, ['heads', 'config', 'worktrees']);
			const child = await track(wt.path);
			extraDisposables.push(child.sub);
			assert.deepStrictEqual(
				{ ...child.sub.current!.upstream },
				{
					name: 'base-local',
					remote: undefined,
					branch: undefined,
					missing: false,
				},
			);
			assert.strictEqual(child.sub.current!.ahead, 1);
			assert.strictEqual(child.sub.current!.behind, 0);
			resetObservations();

			let changed = nextChange(child);
			await repoOf(main.path).branches.deleteLocalBranch!('base-local', {
				force: true,
			});
			assert.strictEqual((await changed).upstream?.missing, true);
			await settle(mainCo, aCo, bCo);

			changed = nextChange(child);
			await repoOf(main.path).branches.createBranch!('base-local', 'feature-a');
			const recreated = await changed;
			assert.strictEqual(recreated.upstream?.missing, false);
			assert.strictEqual(recreated.ahead, 1);
			assert.strictEqual(recreated.behind, 1, 'the recreated upstream has a commit the child lacks');
		});
	});

	suite('config reports racing a write', () => {
		// A debounce longer than the write keeps a report pending when the announcement arrives
		suiteSetup(() => {
			subscribeDelayMs = 400;
		});
		suiteTeardown(() => {
			subscribeDelayMs = debounceMs;
		});

		test("the watcher's report of a delete's config change, pending when it is announced, is the delete's own", async () => {
			await repoOf(main.path).branches.createBranch!('topic', 'origin/feature-a');
			fireConfigChanged();
			await settle();
			resetObservations();

			// Git rewrote `.git/config` before core announced the delete: report it, and let its read land, in between
			const branches = provider.branches as unknown as {
				forgetDeletedBranch(repoPath: string, name: string): Promise<void>;
			};
			const forget = branches.forgetDeletedBranch;
			branches.forgetDeletedBranch = async function (this: unknown, repoPath: string, name: string) {
				fireConfigChanged();
				await delay(50);
				return forget.call(this, repoPath, name);
			};
			try {
				await repoOf(main.path).branches.deleteLocalBranch!('topic');
			} finally {
				branches.forgetDeletedBranch = forget;
			}
			await settle();
			// ...and the same report again, after the announcement fired
			fireConfigChanged();
			await settle();

			for (const co of [mainCo, aCo, bCo]) {
				assert.strictEqual(readsOf(co), 0, `${co.key} was not recomputed`);
				const events = heardBy(co);
				assert.strictEqual(events.length, 1, `${co.key} heard the delete once`);
				assert.deepStrictEqual([...events[0].announced].sort(), ['config', 'heads']);
				assert.deepStrictEqual([...events[0].configBranches!], ['refs/heads/topic']);
				assert.ok(!events[0].changed('remotes'), 'no remote changed');
			}
		});

		test("an outside edit to a sibling's branch config, pending when a branch write is announced, recomputes it", async () => {
			assert.strictEqual(bCo.sub.current!.upstream, undefined);

			git(main.path, 'config', 'branch.feature-b.remote', '.');
			git(main.path, 'config', 'branch.feature-b.merge', 'refs/heads/main');
			fireConfigChanged();
			await delay(50);
			const changed = nextChange(bCo);
			await repoOf(main.path).branches.createBranch!('topic', 'origin/feature-a');
			const b = await changed;
			await settle();

			assert.strictEqual(b.upstream?.name, 'main');
			assert.strictEqual(readsOf(aCo), 0, 'feature-a follows neither branch');
			assert.strictEqual(readsOf(mainCo), 0, 'main follows neither branch');
			const events = heardBy(bCo);
			assert.strictEqual(events.length, 1);
			assert.ok(!events[0].announced.has('config'), 'the outside edit rides along, so config is not announced');
			assert.deepStrictEqual([...events[0].configBranches!].sort(), ['refs/heads/feature-b', 'refs/heads/topic']);
		});

		test('an outside `git branch -u` racing a delete recomputes the sibling it set', async () => {
			await repoOf(main.path).branches.createBranch!('topic', 'origin/feature-a');
			fireConfigChanged();
			await settle();
			resetObservations();

			await repoOf(main.path).branches.deleteLocalBranch!('topic');
			git(main.path, 'branch', '-q', '-u', 'origin/feature-a', 'feature-b');
			const changed = nextChange(bCo);
			fireConfigChanged();
			const b = await changed;
			await settle();

			assert.strictEqual(b.upstream?.name, 'origin/feature-a');
			assert.strictEqual(readsOf(aCo), 0, 'feature-a follows neither branch');
			assert.strictEqual(readsOf(mainCo), 0, 'main follows neither branch');
			assert.ok(heardBy(bCo).every(e => !e.announced.has('config')));
		});

		test('a raw report of another branch, in the window of a write naming one, reaches who follows it', async () => {
			const sibling = bCo.sub.current!.sha;
			await repoOf(main.path).branches.createBranch!('topic', 'HEAD');

			// An outside commit on feature-b, reported while the create is pending
			addCommit(linked[1].path, 'outside.txt', 'outside', 'Outside work on feature-b');
			const head = git(linked[1].path, 'rev-parse', 'HEAD');
			const dotGit = normalizePath(join(main.path, '.git'));
			for (const w of watchers.filter(w => normalizePath(w.basePath) === dotGit)) {
				w.fire({ path: join(w.basePath, 'refs', 'heads', 'feature-b'), reason: 'change' });
			}
			await settle();

			assert.notStrictEqual(head, sibling);
			assert.strictEqual(bCo.sub.current!.sha, head, 'feature-b read its new tip');
			for (const co of [mainCo, aCo]) {
				const events = heardBy(co);
				assert.strictEqual(events.length, 1);
				assert.ok(!events[0].announced.has('heads'), `${co.key}: the outside commit is not the create's`);
				assert.ok(events[0].mayHaveChangedRef('refs/heads/feature-b'));
				assert.strictEqual(readsOf(co), 0, `${co.key} follows neither branch`);
			}
		});
	});

	suite('fetch beside an outside fetch', () => {
		// A debounce longer than the write keeps the outside event pending when the announcement arrives
		suiteSetup(() => {
			subscribeDelayMs = 400;
		});
		suiteTeardown(() => {
			subscribeDelayMs = debounceMs;
		});

		test('an outside change to a ref the announcement does not name is still refreshed', async () => {
			const tip = peerPushesMain('outside');
			git(peer.path, 'push', 'origin', 'main:refs/heads/named');

			// An outside `git fetch`, which core neither runs nor announces; its watcher events are all core hears
			git(main.path, 'fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main');
			const dotGit = normalizePath(join(main.path, '.git'));
			for (const w of watchers.filter(w => normalizePath(w.basePath) === dotGit)) {
				w.fire({
					path: join(w.basePath, 'refs', 'remotes', 'origin', 'main'),
					reason: 'change',
				});
			}

			// Core's own fetch moves a different ref and announces just that
			await repoOf(main.path).ops!.fetch({
				remote: 'origin',
				refspecs: ['+refs/heads/named:refs/remotes/origin/named'],
			});
			await settle();

			for (const co of [aCo, bCo]) {
				assert.strictEqual(co.sub.current?.base?.sha, tip, `${co.key} read the outside fetch's origin/main`);
			}
			assert.strictEqual(mainCo.sub.current?.behind, 1, 'main reads its upstream as moved by the outside fetch');
		});
	});
});
