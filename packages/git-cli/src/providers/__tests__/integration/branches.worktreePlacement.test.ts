import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import type { GitService } from '@gitlens/git/service.js';
import type { WatcherRepoChangeEvent } from '@gitlens/git/watching/changeEvent.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { ProcessSpawner } from '@gitlens/utils/env/node/exec.js';
import { spawnProcess } from '@gitlens/utils/env/node/exec.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, getRepositoryKey } from '@gitlens/utils/uri.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import { createCliGitService } from '../../../service.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo, createWorktree, noCommitGraphWritesConfig } from './helpers.js';

const debounceMs = 10;
/** Long enough for an event raised by a fired watcher report to have been debounced and delivered */
const settleMs = 150;

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/** Where `branches` places the branch `name`: the path of the worktree it is checked out in, or `false` */
function placementOf(branches: readonly GitBranch[], name: string): string | false | undefined {
	const branch = branches.find(b => b.name === name);
	assert.ok(branch != null, `branch ${name}`);
	return branch.worktree === false ? false : branch.worktree?.path;
}

/**
 * A main checkout, watched (only the file watchers are fakes), and a linked worktree on `task-0`, registered, that a
 * checkout outside core moves. What the main checkout reads of where each branch is checked out follows the move once
 * its watcher reports that worktree's HEAD, without anything having read the worktree list.
 */
suite('Where each branch is checked out, after a linked worktree checks out a branch (real git)', () => {
	let repo: TestRepo;
	let linked: ReturnType<typeof createWorktree>;
	let root: string;
	let service: GitService;
	let provider: CliGitProvider;
	let watchers: { basePath: string; fire: (event: FileWatchEvent) => void }[];
	let disposables: { dispose(): void }[];
	/** The argv of each git process launched */
	let launches: string[];
	/** What the host was told: the cache types each path was reset for, and the changes each path was notified of */
	let resets: { repoPath: string; types: CachedGitTypes[] }[];
	let notified: { repoPath: string; changes: RepositoryChange[] }[];

	setup(() => {
		repo = createTestRepo();
		for (const name of ['task-0', 'spare']) {
			createBranch(repo.path, name);
		}
		linked = createWorktree(repo.path, 'task-0');
		root = mkdtempSync(join(tmpdir(), 'gitlens-placement-'));

		launches = [];
		resets = [];
		notified = [];
		watchers = [];
		disposables = [];
		const spawn: ProcessSpawner = (command, args, options) => {
			launches.push(args.join(' '));
			return spawnProcess(command, args, options);
		};
		service = createCliGitService({
			context: {
				fs: repo.provider.context.fs,
				config: noCommitGraphWritesConfig,
				hooks: {
					cache: {
						onReset: (repoPath, ...types) =>
							resets.push({ repoPath: normalizePath(repoPath), types: types }),
					},
					repository: {
						onChanged: (repoPath, changes) =>
							notified.push({ repoPath: normalizePath(repoPath), changes: [...changes] }),
					},
				},
			},
			gitOptions: { spawn: spawn },
			watchingProvider: {
				createWatcher: function (basePath, _pattern, onEvent) {
					watchers.push({ basePath: basePath, fire: onEvent });
					return createDisposable(() => {});
				},
			} satisfies FileWatchingProvider,
		});
		provider = service.getProvider(repo.path)!.provider as CliGitProvider;
	});

	teardown(() => {
		for (const d of disposables) {
			d.dispose();
		}
		service.dispose();
		linked.cleanup();
		repo.cleanup();
		rmSync(root, { recursive: true, force: true });
	});

	async function register(path: string): Promise<void> {
		provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
	}

	/** Watches `path` as a host does, returning what it hears */
	async function watch(path: string): Promise<{ events: WatcherRepoChangeEvent[]; next: () => Promise<void> }> {
		const handle = service.watchService!.watch(getRepositoryKey(path), await provider.config.getGitDir(path));
		assert.ok(handle != null);
		const sub = handle.session.subscribe({ delayMs: debounceMs });
		const events: WatcherRepoChangeEvent[] = [];
		disposables.push(
			sub.onDidChange(e => events.push(e)),
			sub,
			handle,
		);
		return {
			events: events,
			next: () =>
				new Promise<void>(resolve => {
					const listener = sub.onDidChange(() => {
						listener.dispose();
						resolve();
					});
				}),
		};
	}

	/** Reports a linked worktree's HEAD file the way the `.git` watchers over the common git dir do */
	function fireWorktreeHead(id: string, reason: FileWatchEvent['reason'] = 'change'): void {
		const dotGit = normalizePath(join(repo.path, '.git'));
		for (const w of watchers.filter(w => normalizePath(w.basePath) === dotGit)) {
			w.fire({ path: join(w.basePath, 'worktrees', id, 'HEAD'), reason: reason });
		}
	}

	async function readBranches(path: string): Promise<GitBranch[]> {
		return (await service.forRepo(path)!.branches.getBranches({ sort: false })).values;
	}

	function linkedId(): string {
		return basename(git(linked.path, 'rev-parse', '--absolute-git-dir'));
	}

	function worktreeListLaunches(): string[] {
		return launches.filter(argv => argv.includes('worktree list'));
	}

	async function setUpWatchedMain(): Promise<Awaited<ReturnType<typeof watch>>> {
		await register(repo.path);
		await register(linked.path);
		const main = await watch(repo.path);
		assert.strictEqual(placementOf(await readBranches(repo.path), 'task-0'), normalizePath(linked.path));
		return main;
	}

	test("a checkout outside core in an unwatched linked worktree is placed there in the main checkout's branch list once the main checkout's watcher reports it", async () => {
		const main = await setUpWatchedMain();
		launches.length = 0;

		git(linked.path, 'switch', '-q', 'spare');
		fireWorktreeHead(linkedId());
		await delay(debounceMs + settleMs);

		assert.ok(
			main.events.some(e => e.changed('worktreeHead')),
			"the main checkout heard the worktree's HEAD move",
		);
		const branches = await readBranches(repo.path);
		assert.strictEqual(placementOf(branches, 'spare'), normalizePath(linked.path));
		assert.strictEqual(placementOf(branches, 'task-0'), false);
		assert.deepStrictEqual(worktreeListLaunches(), [], 'without reading the worktree list');
	});

	test("a watched linked worktree's checkout outside core is placed there in the main checkout's branch list read on the main checkout's report, before the worktree's own", async () => {
		const main = await setUpWatchedMain();
		await watch(linked.path);
		launches.length = 0;

		git(linked.path, 'switch', '-q', 'spare');
		const heard = main.next();
		// Only the common git dir's watchers report it: the worktree's own report of its HEAD hasn't arrived
		fireWorktreeHead(linkedId());
		await heard;
		const branches = await readBranches(repo.path);

		assert.strictEqual(placementOf(branches, 'spare'), normalizePath(linked.path));
		assert.strictEqual(placementOf(branches, 'task-0'), false);
		assert.deepStrictEqual(worktreeListLaunches(), [], 'without reading the worktree list');
	});

	test("the worktree list read after the main checkout's report agrees with the branch list, so nothing is re-read or re-announced", async () => {
		await setUpWatchedMain();

		git(linked.path, 'switch', '-q', 'spare');
		fireWorktreeHead(linkedId());
		await delay(debounceMs + settleMs);
		const branches = await readBranches(repo.path);
		resets.length = 0;
		notified.length = 0;
		launches.length = 0;

		const worktrees = await service.forRepo(repo.path)!.worktrees!.getWorktrees();

		assert.strictEqual(
			worktrees.find(w => normalizePath(w.path) === normalizePath(linked.path))?.branchName,
			'spare',
		);
		assert.deepStrictEqual(resets, [], 'no cache type reset for the host');
		assert.deepStrictEqual(notified, [], 'no change re-announced to the host');
		assert.deepStrictEqual(
			launches.filter(argv => argv.includes('for-each-ref')),
			[],
			`the branches aren't listed again: ${launches.join('\n')}`,
		);
		assert.strictEqual(placementOf(branches, 'spare'), normalizePath(linked.path));
	});

	test("a worktree core adds on an existing branch, and then removes, is placed and unplaced in the main checkout's branch list", async () => {
		const main = await setUpWatchedMain();
		assert.strictEqual(placementOf(await readBranches(repo.path), 'spare'), false);
		const path = join(root, 'wt-spare');

		await service.forRepo(repo.path)!.worktrees!.createWorktree(path, { commitish: 'spare' });
		fireWorktreeHead('wt-spare', 'create');
		await delay(debounceMs + settleMs);

		assert.ok(main.events.some(e => e.changed('worktreeHead')));
		assert.strictEqual(placementOf(await readBranches(repo.path), 'spare'), normalizePath(path));

		await service.forRepo(repo.path)!.worktrees!.deleteWorktree(path);
		fireWorktreeHead('wt-spare', 'delete');
		await delay(debounceMs + settleMs);

		assert.strictEqual(placementOf(await readBranches(repo.path), 'spare'), false);
	});

	function testFirstCheckoutBase(registered: boolean): void {
		test(`a branch first checked out outside core in ${registered ? 'a registered' : 'an unregistered'} unwatched linked worktree gets the base that checkout gives it, read from the main checkout after its branch list`, async () => {
			await register(repo.path);
			if (registered) {
				await register(linked.path);
			}
			await watch(repo.path);
			// Created from a commit, not a branch, so its base is the branch it is first checked out from
			git(repo.path, 'branch', 'y', git(repo.path, 'rev-parse', 'HEAD'));
			assert.match(git(repo.path, 'reflog', 'show', '--format=%gs', 'y'), /^branch: Created from [0-9a-f]{40}$/);
			assert.strictEqual(placementOf(await readBranches(repo.path), 'task-0'), normalizePath(linked.path));
			const branches = service.forRepo(repo.path)!.branches;
			assert.strictEqual(await branches.getBaseBranchName!('y'), undefined, 'never checked out yet');

			git(linked.path, 'switch', '-q', 'y');
			fireWorktreeHead(linkedId());
			await delay(debounceMs + settleMs);

			// As a host re-reads on the main checkout's event
			assert.strictEqual(placementOf(await readBranches(repo.path), 'y'), normalizePath(linked.path));
			assert.strictEqual(await branches.getBaseBranchName!('y'), 'task-0');
		});
	}

	testFirstCheckoutBase(true);
	testFirstCheckoutBase(false);
});
