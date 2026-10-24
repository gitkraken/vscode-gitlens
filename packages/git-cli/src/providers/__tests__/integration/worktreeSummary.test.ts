import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { AheadOfBase } from '@gitlens/git/providers/branches.js';
import type { GitService } from '@gitlens/git/service.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import type { WorktreeSummary, WorktreeSummarySubscription } from '@gitlens/git/watching/worktreeSummary.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, toFsPath } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../../../cliGitProvider.js';
import { createCliGitService } from '../../../service.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	cloneTestRepo,
	createProvider,
	createShadowCheckedGitService,
	createTestRepo,
	createWorktree,
	noCommitGraphWritesConfig,
} from './helpers.js';
import { verifyBaseRemeasure } from './shadowCheck.js';

const fs: FileSystemProvider = {
	readFile: async uri => readFileSync(toFsPath(uri)),
	stat: async uri => {
		try {
			const stats = statSync(toFsPath(uri));
			return { type: stats.isDirectory() ? 2 : 1, ctime: stats.ctimeMs, mtime: stats.mtimeMs, size: stats.size };
		} catch {
			return undefined;
		}
	},
	readDirectory: async () => [],
};

function nextChange(sub: WorktreeSummarySubscription): Promise<WorktreeSummary> {
	return new Promise(resolve => {
		const listener = sub.onDidChange(e => {
			listener.dispose();
			resolve(e);
		});
	});
}

suite('WorktreeSummaryService against real git', () => {
	let repo: TestRepo;
	let service: GitService;
	let watchers: { basePath: string; fire: (event: FileWatchEvent) => void }[];

	function git(...args: string[]): void {
		execFileSync('git', args, { cwd: repo.path, stdio: 'pipe' });
	}

	function revParse(ref: string): string {
		return execFileSync('git', ['rev-parse', ref], { cwd: repo.path, encoding: 'utf-8' }).trim();
	}

	function mergeBase(ref: string): string {
		return execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: repo.path, encoding: 'utf-8' }).trim();
	}

	function fire(basePath: string, relativePath: string): void {
		const watcher = watchers.find(w => w.basePath === basePath);
		assert.ok(watcher != null, `no watcher on ${basePath}`);
		watcher.fire({ path: join(basePath, relativePath), reason: 'change' });
	}

	setup(() => {
		repo = createTestRepo();
		watchers = [];
		const watchingProvider: FileWatchingProvider = {
			createWatcher: function (basePath, _pattern, onEvent) {
				watchers.push({ basePath: basePath, fire: onEvent });
				return createDisposable(() => {});
			},
		};
		service = createShadowCheckedGitService({ context: { fs: fs }, watchingProvider: watchingProvider });
	});

	teardown(() => {
		service.dispose();
		repo.cleanup();
	});

	test('reads the worktree and follows edits and a branch switch through the cache', async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);
		assert.strictEqual(initial.branch, 'main');
		assert.strictEqual(initial.detached, false);
		assert.strictEqual(initial.dirty, false);
		assert.strictEqual(initial.upstream, undefined);
		// `main` is its own default branch, so there's no base to measure against
		assert.strictEqual(initial.base, undefined);

		// An edit, seen by the working-tree watcher
		const edited = nextChange(sub);
		writeFileSync(join(repo.path, 'README.md'), '# Edited\n');
		fire(repo.path, 'README.md');
		assert.strictEqual((await edited).dirty, true);

		// A commit on a new branch, seen as a HEAD change: the branch read must not be served from a stale cache
		const switched = nextChange(sub);
		git('checkout', '-q', '-b', 'feature');
		git('commit', '-q', '-am', 'Edit');
		const gitDir = watchers.find(w => w.basePath.endsWith('.git'))?.basePath;
		assert.ok(gitDir != null);
		fire(gitDir, 'HEAD');
		const after = await switched;
		assert.strictEqual(after.branch, 'feature');
		assert.strictEqual(after.dirty, false);
		assert.strictEqual(after.sha, revParse('HEAD'));
		assert.deepStrictEqual(after.base, {
			ref: 'main',
			ahead: 1,
			sha: revParse('main'),
			forkPoint: mergeBase('main'),
			tier: 'default',
		});

		sub.dispose();
	});

	test('tracks the config inputs that can change ahead-of-base resolution', async () => {
		// The key is cached until a config change evicts it, so each read first reports one, as the watcher would
		const getKey = () => {
			repo.provider.cache.onRepositoryChanged(repo.path, ['config']);
			return repo.provider.branches.getAheadOfBaseConfigKey(repo.path);
		};
		let key = await getKey();
		assert.strictEqual(typeof key, 'string');

		git('config', 'user.name', 'Unrelated');
		assert.strictEqual(await getKey(), key, 'unrelated config does not change the fingerprint');

		for (const [name, value] of [
			['init.defaultBranch', 'develop'],
			['branch.main.remote', 'origin'],
			['branch.main.merge', 'refs/heads/main'],
			['branch.candidate.remote', 'upstream'],
			['branch.candidate.merge', 'refs/heads/topic'],
		] as const) {
			git('config', name, value);
			const next = await getKey();
			assert.notStrictEqual(next, key, `${name} is included in the fingerprint`);
			key = next;
		}

		git('remote', 'add', 'origin', 'https://example.invalid/origin.git');
		let next = await getKey();
		assert.notStrictEqual(next, key, 'adding a remote changes the fingerprint');
		key = next;

		git('config', '--add', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
		next = await getKey();
		assert.notStrictEqual(next, key, 'a remote fetch refspec changes the fingerprint');
		key = next;

		git('config', '--add', 'remote.origin.fetch', '+refs/heads/release:refs/remotes/origin/release');
		next = await getKey();
		assert.notStrictEqual(next, key, 'adding a repeated fetch refspec changes the fingerprint');
		key = next;

		git(
			'config',
			'--replace-all',
			'remote.origin.fetch',
			'+refs/heads/topic:refs/remotes/origin/topic',
			'^\\+refs/heads/main:refs/remotes/origin/main$',
		);
		next = await getKey();
		assert.notStrictEqual(next, key, 'changing an earlier value in a multi-value setting changes the fingerprint');
		key = next;

		git('remote', 'remove', 'origin');
		assert.notStrictEqual(await getKey(), key, 'removing a remote changes the fingerprint');
	});

	test('refreshes a linked worktree base when a different branch changes its worktree-specific upstream', async () => {
		const linkedRoot = mkdtempSync(join(tmpdir(), 'gitlens-summary-config-'));
		const linkedPath = normalizePath(join(linkedRoot, 'checkout'));
		const provider = service.getProvider(repo.path)?.provider;
		assert.ok(provider instanceof CliGitProvider);
		let added = false;
		try {
			const initialTip = revParse('HEAD');
			git('checkout', '-q', '-b', 'feature');
			git('commit', '-q', '--allow-empty', '-m', 'First feature commit');
			const nearerTip = revParse('HEAD');
			git('commit', '-q', '--allow-empty', '-m', 'Second feature commit');
			git('checkout', '-q', 'main');
			git('remote', 'add', 'origin', 'https://example.invalid/origin.git');
			git('remote', 'add', 'alternate', 'https://example.invalid/alternate.git');
			git('update-ref', 'refs/remotes/origin/main', initialTip);
			git('update-ref', 'refs/remotes/alternate/main', nearerTip);
			git('config', 'branch.main.remote', 'origin');
			git('config', 'branch.main.merge', 'refs/heads/main');
			git('config', 'extensions.worktreeConfig', 'true');
			git('worktree', 'add', '-q', linkedPath, 'feature');
			added = true;
			for (const path of [repo.path, linkedPath]) {
				provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
			}

			const summaries = service.summaries!;
			const sub = summaries.subscribe(linkedPath, { delayMs: 1, workingTreeDelayMs: 1 });
			try {
				const initial = await summaries.getSummary(linkedPath);
				assert.strictEqual(initial.base?.ref, 'origin/main');
				assert.strictEqual(initial.base?.ahead, 2);
				assert.strictEqual(initial.upstream, undefined);
				const changed = new Promise<void>(resolve => {
					const listener = service.watchService!.onDidChangeRepository(e => {
						if (!e.changed('config')) return;

						listener.dispose();
						setImmediate(resolve);
					});
				});
				execFileSync('git', ['config', '--worktree', 'branch.main.remote', 'alternate'], { cwd: linkedPath });
				const gitDir = toFsPath((await provider.config.getGitDir(linkedPath)).uri);
				fire(gitDir, 'config.worktree');
				await changed;
				const after = await summaries.getSummary(linkedPath);
				const direct = await service.forRepo(linkedPath)!.branches.getAheadOfBase!('feature');
				assert.strictEqual(direct?.base?.ref, 'alternate/main');
				assert.strictEqual(direct?.base?.ahead, 1);
				assert.strictEqual(after.sha, initial.sha);
				assert.strictEqual(after.upstream, undefined);
				assert.strictEqual(after.stale, false);
				assert.deepStrictEqual(after.base, direct?.base);
			} finally {
				sub.dispose();
			}
		} finally {
			provider.cache.unregisterRepoPath(linkedPath);
			provider.cache.unregisterRepoPath(repo.path);
			if (added) {
				git('worktree', 'remove', '--force', linkedPath);
			}
			rmSync(linkedRoot, { recursive: true, force: true });
		}
	});

	test('registered sibling checkouts retain distinct effective config in either reader order', async () => {
		const linkedRoot = mkdtempSync(join(tmpdir(), 'gitlens-summary-linked-'));
		const linkedPath = normalizePath(join(linkedRoot, 'checkout'));
		const getKey = (path: string) => repo.provider.branches.getAheadOfBaseConfigKey(path);
		let added = false;
		let registered = false;
		try {
			git('config', 'extensions.worktreeConfig', 'true');
			git('worktree', 'add', '--detach', linkedPath);
			added = true;
			execFileSync('git', ['-C', linkedPath, 'config', '--worktree', 'branch.main.remote', 'linked-origin'], {
				stdio: 'pipe',
			});

			// Unregistered, a path is a repository of its own and reads its own effective config
			assert.ok((await getKey(linkedPath))?.includes('linked-origin'), 'an unregistered path reads its own');

			for (const path of [repo.path, linkedPath]) {
				repo.provider.cache.registerRepoPath(fileUri(path), await repo.provider.config.getGitDir(path));
			}
			registered = true;

			for (const order of [
				[linkedPath, repo.path],
				[repo.path, linkedPath],
			]) {
				repo.provider.cache.evictCaches(repo.path, 'config');
				const keys = new Map(await Promise.all(order.map(async path => [path, await getKey(path)] as const)));
				assert.ok(keys.get(linkedPath)?.includes('linked-origin'));
				assert.ok(!keys.get(repo.path)?.includes('linked-origin'));
				assert.notStrictEqual(keys.get(linkedPath), keys.get(repo.path));
			}
		} finally {
			if (registered) {
				repo.provider.cache.unregisterRepoPath(linkedPath);
				repo.provider.cache.unregisterRepoPath(normalizePath(repo.path));
			}
			try {
				if (added) {
					execFileSync('git', ['worktree', 'remove', '--force', linkedPath], {
						cwd: repo.path,
						stdio: 'pipe',
					});
				}
			} finally {
				rmSync(linkedRoot, { recursive: true, force: true });
			}
		}
	});

	test('a HEAD checkout invalidates config selected by includeIf.onbranch', async () => {
		const includePath = join(repo.path, 'branch-config');
		writeFileSync(includePath, '[branch "main"]\nremote = conditional-origin\n');
		git('config', 'includeIf.onbranch:feature.path', includePath);
		const provider = repo.provider;
		provider.cache.registerRepoPath(fileUri(repo.path), await provider.config.getGitDir(repo.path));
		const before = await provider.branches.getAheadOfBaseConfigKey(repo.path);
		assert.ok(!before?.includes('conditional-origin'));
		git('checkout', '-q', '-b', 'feature');
		provider.cache.onRepositoryChanged(repo.path, ['head']);
		assert.ok((await provider.branches.getAheadOfBaseConfigKey(repo.path))?.includes('conditional-origin'));
		git('checkout', '-q', 'main');
		provider.cache.onRepositoryChanged(repo.path, ['head']);
		assert.strictEqual(await provider.branches.getAheadOfBaseConfigKey(repo.path), before);
	});

	test('refreshes the default branch base when its configured upstream changes', async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		const previousTip = revParse('HEAD');
		git('commit', '-q', '--allow-empty', '-m', 'Advance main');
		git('remote', 'add', 'origin', 'https://example.invalid/origin.git');
		git('update-ref', 'refs/remotes/origin/main', previousTip);
		git('update-ref', 'refs/remotes/origin/develop', previousTip);
		git('config', 'branch.main.remote', 'origin');
		git('config', 'branch.main.merge', 'refs/heads/main');

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);
		assert.strictEqual(initial.upstream?.name, 'origin/main');
		assert.strictEqual(initial.base?.ref, 'origin/main');

		const changed = nextChange(sub);
		git('config', 'branch.main.merge', 'refs/heads/develop');
		const gitDir = watchers.find(w => w.basePath.endsWith('.git'))?.basePath;
		assert.ok(gitDir != null);
		fire(gitDir, 'config');
		const after = await changed;

		assert.strictEqual(after.upstream?.name, 'origin/develop');
		assert.strictEqual(after.base?.ref, 'origin/develop');
		assert.strictEqual(after.base?.ahead, 1);

		sub.dispose();
	});

	test('measures a detached HEAD against the default branch and follows commits made on it', async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		git('checkout', '-q', '-b', 'feature');
		git('commit', '-q', '--allow-empty', '-m', 'Feature');

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);
		assert.strictEqual(initial.branch, 'feature');
		assert.strictEqual(initial.base?.ahead, 1);

		const gitDir = watchers.find(w => w.basePath.endsWith('.git'))?.basePath;
		assert.ok(gitDir != null);

		const detached = nextChange(sub);
		git('checkout', '-q', '--detach');
		fire(gitDir, 'HEAD');
		const afterDetach = await detached;

		assert.strictEqual(afterDetach.detached, true);
		assert.strictEqual(afterDetach.branch, undefined);
		assert.deepStrictEqual(afterDetach.base, {
			ref: 'main',
			ahead: 1,
			sha: revParse('main'),
			forkPoint: mergeBase('main'),
			tier: 'default',
		});

		const committed = nextChange(sub);
		git('commit', '-q', '--allow-empty', '-m', 'Detached');
		fire(gitDir, 'HEAD');
		const afterCommit = await committed;

		assert.strictEqual(afterCommit.sha, revParse('HEAD'));
		assert.strictEqual(afterCommit.base?.ref, 'main');
		assert.strictEqual(afterCommit.base?.ahead, 2);
		assert.strictEqual(afterCommit.base?.tier, 'default');

		const switched = nextChange(sub);
		git('checkout', '-q', 'main');
		fire(gitDir, 'HEAD');
		const onMain = await switched;

		assert.strictEqual(onMain.branch, 'main');
		assert.strictEqual(onMain.detached, false);
		assert.strictEqual(onMain.base, undefined, 'main is its own default branch');

		sub.dispose();
	});

	test('reports the base of a worktree that starts out detached', async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		git('checkout', '-q', '-b', 'feature');
		git('commit', '-q', '--allow-empty', '-m', 'Feature');
		git('checkout', '-q', '--detach');

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);

		assert.strictEqual(initial.detached, true);
		assert.deepStrictEqual(initial.base, {
			ref: 'main',
			ahead: 1,
			sha: revParse('main'),
			forkPoint: mergeBase('main'),
			tier: 'default',
		});
		assert.deepStrictEqual(
			initial.baseDependsOn,
			(await repo.provider.branches.getAheadOfBase(repo.path, undefined))?.dependsOn,
		);

		sub.dispose();
	});

	test('reports the refs the base depends on, as getAheadOfBase does, with or without a base', async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);
		assert.strictEqual(initial.base, undefined);
		assert.ok(initial.baseDependsOn.length > 0);
		assert.deepStrictEqual(
			initial.baseDependsOn,
			(await repo.provider.branches.getAheadOfBase(repo.path, 'main'))?.dependsOn,
		);

		const switched = nextChange(sub);
		git('checkout', '-q', '-b', 'feature');
		git('commit', '-q', '--allow-empty', '-m', 'Feature');
		const gitDir = watchers.find(w => w.basePath.endsWith('.git'))?.basePath;
		assert.ok(gitDir != null);
		fire(gitDir, 'HEAD');
		const after = await switched;

		assert.ok(after.base != null);
		assert.deepStrictEqual(
			after.baseDependsOn,
			(await repo.provider.branches.getAheadOfBase(repo.path, 'feature'))?.dependsOn,
		);

		sub.dispose();
	});

	test('fires for a commit and a fast-forward of the base that leave every count the same', async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		git('checkout', '-q', '-b', 'feature');
		git('commit', '-q', '--allow-empty', '-m', 'First');

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);
		assert.strictEqual(initial.sha, revParse('HEAD'));
		assert.deepStrictEqual(initial.base, {
			ref: 'main',
			ahead: 1,
			sha: revParse('main'),
			forkPoint: mergeBase('main'),
			tier: 'default',
		});

		// A commit, then `main` fast-forwarded onto the first one, inside one refresh window: still 1 ahead of `main`
		const changed = nextChange(sub);
		git('commit', '-q', '--allow-empty', '-m', 'Second');
		git('branch', '-f', 'main', 'HEAD~1');
		const gitDir = watchers.find(w => w.basePath.endsWith('.git'))?.basePath;
		assert.ok(gitDir != null);
		fire(gitDir, 'refs/heads/feature');
		fire(gitDir, 'refs/heads/main');
		const after = await changed;

		assert.strictEqual(after.ahead, initial.ahead);
		assert.strictEqual(after.behind, initial.behind);
		assert.strictEqual(after.base?.ahead, 1);
		assert.strictEqual(after.sha, revParse('HEAD'));
		assert.notStrictEqual(after.sha, initial.sha);
		assert.strictEqual(after.base?.sha, revParse('main'));
		assert.notStrictEqual(after.base?.sha, initial.base?.sha);

		sub.dispose();
	});

	test('fires when only the base moves on, re-reading its tip after the move cleared the ref list', async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		git('checkout', '-q', '-b', 'feature');
		git('commit', '-q', '--allow-empty', '-m', 'Feature');

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);
		assert.deepStrictEqual(initial.base, {
			ref: 'main',
			ahead: 1,
			sha: revParse('main'),
			forkPoint: mergeBase('main'),
			tier: 'default',
		});

		// `main` gains a commit `feature` doesn't have, so `feature` is still 1 ahead of it and HEAD doesn't move
		const changed = nextChange(sub);
		const mainTip = execFileSync('git', ['commit-tree', 'main^{tree}', '-p', 'main', '-m', 'Main'], {
			cwd: repo.path,
			encoding: 'utf-8',
		}).trim();
		git('update-ref', 'refs/heads/main', mainTip);
		const gitDir = watchers.find(w => w.basePath.endsWith('.git'))?.basePath;
		assert.ok(gitDir != null);
		fire(gitDir, 'refs/heads/main');
		const after = await changed;

		assert.strictEqual(after.sha, initial.sha);
		assert.deepStrictEqual(after.base, {
			ref: 'main',
			ahead: 1,
			sha: mainTip,
			forkPoint: mergeBase('main'),
			tier: 'default',
		});

		sub.dispose();
	});

	test("returns the new base right after core's awaited merge-target store, with no watcher event", async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		git('checkout', '-q', '-b', 'feature');
		git('commit', '-q', '--allow-empty', '-m', 'Feature');
		git('branch', 'release', 'HEAD');

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);
		assert.strictEqual(initial.base?.ref, 'main');
		assert.strictEqual(initial.base?.tier, 'default');

		await service.forRepo(repo.path)!.branches.storeUserMergeTargetBranchName!('feature', 'release');
		const after = await summaries.getSummary(repo.path);

		assert.deepStrictEqual(after.base, {
			ref: 'release',
			ahead: 0,
			sha: revParse('HEAD'),
			forkPoint: revParse('HEAD'),
			tier: 'user',
		});

		sub.dispose();
	});

	test('re-counts a tag-named base when the tag moves', async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		git('tag', 'base');
		git('checkout', '-q', '-b', 'feature');
		git('commit', '-q', '--allow-empty', '-m', 'Feature');
		mkdirSync(join(repo.path, '.git', 'gk'), { recursive: true });
		git('config', '--file', join(repo.path, '.git', 'gk', 'config'), 'branch.feature.gk-merge-target-user', 'base');

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);
		assert.deepStrictEqual(initial.base, {
			ref: 'base',
			ahead: 1,
			sha: revParse('main'),
			forkPoint: mergeBase('base'),
			tier: 'user',
		});

		// The count and fork point are cached by the tag's name, so they must not outlive the tag's move
		const changed = nextChange(sub);
		git('tag', '-f', 'base', 'HEAD');
		const gitDir = watchers.find(w => w.basePath.endsWith('.git'))?.basePath;
		assert.ok(gitDir != null);
		fire(gitDir, 'refs/tags/base');
		const after = await changed;

		assert.deepStrictEqual(after.base, {
			ref: 'base',
			ahead: 0,
			sha: revParse('HEAD'),
			forkPoint: mergeBase('base'),
			tier: 'user',
		});

		sub.dispose();
	});
});

/**
 * A base whose own ref moved forward, with none of HEAD's commits reaching it, is re-measured from the previous answer
 * rather than resolved again. Every answer the re-measure gives is checked against a full `getAheadOfBase` read
 * fresh, through a provider with cold caches, fork point included; every case it must decline is checked to decline.
 */
suite('Re-measuring a base after only its own ref moved', () => {
	const originMain = 'refs/remotes/origin/main';
	const originHead = 'refs/remotes/origin/HEAD';
	/** What a fetch that moved `origin/main` names */
	const fetchedMain = [originMain, originHead];

	let root: string;
	let origin: string;
	let repo: TestRepo;
	let peer: TestRepo;

	function git(cwd: string, ...args: string[]): string {
		return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
	}

	/** Moves `origin/main` on by one commit, as another user's push and this checkout's fetch would */
	function peerPushesMain(name: string): string {
		addCommit(peer.path, `${name}.txt`, name, `Peer ${name}`);
		git(peer.path, 'push', '-q', 'origin', 'main');
		git(repo.path, 'fetch', '-q', 'origin');
		return git(repo.path, 'rev-parse', originMain);
	}

	async function withProvider<T>(read: (provider: CliGitProvider) => Promise<T>): Promise<T> {
		const provider = createProvider();
		try {
			return await read(provider);
		} finally {
			provider.dispose();
		}
	}

	function readFresh(branch: string | undefined): Promise<AheadOfBase> {
		return withProvider(p => p.branches.getAheadOfBase(repo.path, branch));
	}

	function remeasure(
		branch: string | undefined,
		previous: AheadOfBase,
		moved: readonly string[],
	): Promise<AheadOfBase | undefined> {
		assert.ok(previous.base != null, 'there is a base to re-measure');
		const head = git(repo.path, 'rev-parse', 'HEAD');
		return withProvider(p =>
			p.branches.getAheadOfBaseAfterBaseMove(
				repo.path,
				branch,
				{
					head: head,
					base: previous.base!,
					dependsOn: previous.dependsOn,
					...(previous.defaultBranch !== undefined ? { defaultBranch: previous.defaultBranch } : undefined),
				},
				moved,
			),
		);
	}

	/** The re-measure answers, and answers what a fresh full read does */
	async function assertRemeasured(branch: string | undefined, previous: AheadOfBase, moved: readonly string[]) {
		const answer = await remeasure(branch, previous, moved);
		const fresh = await readFresh(branch);
		assert.ok(answer != null, 'the re-measure answers');
		assert.deepStrictEqual(answer, fresh);
		assert.notStrictEqual(answer.base?.sha, previous.base?.sha, 'the base moved');
		return answer;
	}

	/** Branch `name` taken off `origin/main` (as a host creates a task branch) and checked out, with `commits` of its own */
	function startTask(name: string, commits: number): string[] {
		git(repo.path, 'checkout', '-q', '--no-track', '-b', name, 'origin/main');
		const shas: string[] = [];
		for (let i = 0; i < commits; i++) {
			addCommit(repo.path, `${name}-${i}.txt`, `${name} ${i}`, `${name} ${i}`);
			shas.push(git(repo.path, 'rev-parse', 'HEAD'));
		}
		return shas;
	}

	setup(() => {
		root = mkdtempSync(join(tmpdir(), 'gitlens-base-move-'));
		origin = join(root, 'origin.git');
		git(root, 'init', '-q', '--bare', '-b', 'main', origin);

		repo = createTestRepo();
		git(repo.path, 'remote', 'add', 'origin', origin);
		git(repo.path, 'push', '-q', '-u', 'origin', 'main');
		git(repo.path, 'remote', 'set-head', 'origin', 'main');

		peer = cloneTestRepo(origin);
	});

	teardown(() => {
		peer.cleanup();
		repo.cleanup();
		rmSync(root, { recursive: true, force: true });
	});

	test('a base that moved forward with none of the branch reaching it is re-measured to the fresh answer', async () => {
		startTask('task', 2);
		const before = await readFresh('task');
		assert.strictEqual(before.base?.ref, 'origin/main');
		assert.strictEqual(before.base?.tier, 'created');

		const tip = peerPushesMain('one');
		const answer = await assertRemeasured('task', before, fetchedMain);
		assert.strictEqual(answer.base?.sha, tip);
		assert.strictEqual(answer.base?.ahead, 2);
		assert.strictEqual(answer.base?.forkPoint, before.base?.forkPoint);

		// And again from the re-measured answer, as the summary keeps it
		peerPushesMain('two');
		await assertRemeasured('task', answer, fetchedMain);
	});

	test('the first move of a base after a clone, which logged nothing for it, is re-measured to the fresh answer', async () => {
		// A clone writes no reflog for `origin/main`, so the old tip is the value its first logged entry replaced
		repo.cleanup();
		repo = cloneTestRepo(origin);
		startTask('task', 2);
		const before = await readFresh('task');
		assert.strictEqual(before.base?.ref, 'origin/main');

		const oldTip = git(repo.path, 'rev-parse', originMain);
		const tip = peerPushesMain('one');
		const logged = git(repo.path, 'reflog', 'show', '--format=%H', originMain).split('\n');
		assert.deepStrictEqual(logged, [tip], 'the reflog holds only the move, not the old tip');

		const answer = await assertRemeasured('task', before, fetchedMain);
		assert.strictEqual(answer.base?.sha, tip);
		assert.strictEqual(answer.base?.ahead, 2);
		assert.notStrictEqual(oldTip, tip);
	});

	test('a branch that landed in the base is read in full', async () => {
		startTask('task', 1);
		const before = await readFresh('task');

		git(repo.path, 'push', '-q', 'origin', 'task');
		git(peer.path, 'fetch', '-q', 'origin', 'task');
		git(peer.path, 'merge', '-q', '--no-ff', '-m', 'Merge task', 'FETCH_HEAD');
		git(peer.path, 'push', '-q', 'origin', 'main');
		git(repo.path, 'fetch', '-q', 'origin');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
		assert.strictEqual((await readFresh('task')).base?.ahead, 0);
	});

	test('a branch whose first commits landed in the base is read in full', async () => {
		const [first] = startTask('task', 2);
		const before = await readFresh('task');

		git(repo.path, 'push', '-q', 'origin', `${first}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
		const fresh = await readFresh('task');
		assert.strictEqual(fresh.base?.ahead, 1);
		assert.strictEqual(fresh.base?.forkPoint, first);
	});

	test('a base that was force-pushed is read in full', async () => {
		peerPushesMain('one');
		startTask('task', 1);
		const before = await readFresh('task');

		git(peer.path, 'reset', '-q', '--hard', 'HEAD~1');
		addCommit(peer.path, 'rewritten.txt', 'rewritten', 'Peer rewritten');
		git(peer.path, 'push', '-q', '--force', 'origin', 'main');
		git(repo.path, 'fetch', '-q', 'origin');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
	});

	test("a force-push that keeps the count by trading one of the branch's commits for another is read in full", async () => {
		// The branch merges two lines of work, `a` and `b`, each taken off `origin/main`
		startTask('task', 0);
		const base = git(repo.path, 'rev-parse', 'HEAD');
		addCommit(repo.path, 'a.txt', 'a', 'Work a');
		const a = git(repo.path, 'rev-parse', 'HEAD');
		git(repo.path, 'checkout', '-q', '-b', 'side', base);
		addCommit(repo.path, 'b.txt', 'b', 'Work b');
		const b = git(repo.path, 'rev-parse', 'HEAD');
		git(repo.path, 'checkout', '-q', 'task');
		git(repo.path, 'merge', '-q', '--no-ff', '-m', 'Merge b', 'side');

		// `a` landed, then the base was force-pushed to hold `b` instead: one of the branch's own commits is missing
		// from the base before and after, but not the same one
		git(repo.path, 'push', '-q', 'origin', `${a}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');
		const before = await readFresh('task');
		assert.strictEqual(before.base?.forkPoint, a);
		git(repo.path, 'push', '-q', '--force', 'origin', `${b}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');
		const fresh = await readFresh('task');
		assert.strictEqual(fresh.base?.ahead, before.base?.ahead, 'the count is the same');
		assert.strictEqual(fresh.base?.forkPoint, b, 'the fork point is not');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
	});

	test("a base that held one of the branch's commits on its way forward is read in full", async () => {
		const [own] = startTask('task', 1);
		const before = await readFresh('task');

		// Both moves land before the summary reads again: the base ends ahead of where it was with the same count,
		// but its reflog now holds the branch's commit, which `--fork-point` takes as where the branch forked
		git(repo.path, 'push', '-q', 'origin', `${own}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');
		addCommit(peer.path, 'moved.txt', 'moved', 'Peer moved');
		git(peer.path, 'push', '-q', '--force', 'origin', 'main');
		git(repo.path, 'fetch', '-q', 'origin');

		const fresh = await readFresh('task');
		assert.strictEqual(fresh.base?.ahead, before.base?.ahead, 'the count is the same');
		assert.strictEqual(fresh.base?.forkPoint, own, 'the fork point is not');
		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
	});

	test("a base moved onto the branch's commit and back before moving forward is read in full", async () => {
		const [own] = startTask('task', 1);
		const before = await readFresh('task');
		const oldTip = before.base?.sha;
		assert.ok(oldTip != null);

		// The reflog's entry before the new tip is the old tip again, so only its whole span since the old tip shows
		// the commit the base held in between
		git(repo.path, 'push', '-q', 'origin', `${own}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');
		git(repo.path, 'push', '-q', '--force', 'origin', `${oldTip}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');
		peerPushesMain('one');

		const fresh = await readFresh('task');
		assert.strictEqual(fresh.base?.ahead, before.base?.ahead, 'the count is the same');
		assert.strictEqual(fresh.base?.forkPoint, own, 'the fork point is not');
		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
	});

	test('a base whose name another listed ref now also answers to is read in full', async () => {
		const [own] = startTask('task', 1);
		const oldTip = git(repo.path, 'rev-parse', originMain);
		// The branch's commit landed and was force-pushed away, so the base's reflog puts the fork point there
		git(repo.path, 'push', '-q', 'origin', `${own}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');
		git(repo.path, 'push', '-q', '--force', 'origin', `${oldTip}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');
		const before = await readFresh('task');
		assert.strictEqual(before.base?.forkPoint, own);

		// A tag created over the base's name, ahead of it with none of the branch's commits: the name now resolves to
		// the tag, and git reads it differently elsewhere too (`--fork-point` refuses it, the remote's `HEAD`
		// shortens to `remotes/origin/main`), so the fresh answer is not the old one at the tag's commit
		const tree = git(repo.path, 'rev-parse', `${oldTip}^{tree}`);
		const tagged = git(repo.path, 'commit-tree', '-p', oldTip, '-m', 'Tagged', tree);
		git(repo.path, 'update-ref', 'refs/tags/origin/main', tagged);
		assert.notDeepStrictEqual((await readFresh('task')).base, { ...before.base, sha: tagged });

		assert.strictEqual(await remeasure('task', before, ['refs/tags/origin/main']), undefined);
	});

	test('a base that moved forward more than once since the last read is re-measured to the fresh answer', async () => {
		startTask('task', 1);
		const before = await readFresh('task');

		peerPushesMain('one');
		peerPushesMain('two');
		await assertRemeasured('task', before, fetchedMain);
	});

	test('a stacked branch whose parent moved forward is re-measured against the parent', async () => {
		startTask('parent', 1);
		git(repo.path, 'branch', 'child', 'parent');
		git(repo.path, 'checkout', '-q', 'child');
		addCommit(repo.path, 'child.txt', 'child', 'Child work');
		const before = await readFresh('child');
		assert.strictEqual(before.base?.ref, 'parent');
		assert.strictEqual(before.base?.tier, 'created');

		// The parent moves on in its own checkout, without the child's work
		const tree = git(repo.path, 'rev-parse', 'parent^{tree}');
		const parentTip = git(repo.path, 'commit-tree', '-p', 'parent', '-m', 'Parent work', tree);
		git(repo.path, 'update-ref', 'refs/heads/parent', parentTip);

		const answer = await assertRemeasured('child', before, ['refs/heads/parent']);
		assert.strictEqual(answer.base?.sha, parentTip);
	});

	test('the default branch measured against its own upstream is re-measured once it diverged from it', async () => {
		addCommit(repo.path, 'local.txt', 'local', 'Unpushed work');
		const before = await readFresh('main');
		assert.strictEqual(before.base?.tier, 'upstream');
		assert.strictEqual(before.base?.forkPoint, before.base?.sha, 'an upstream HEAD contains is its own fork point');

		// Moving past HEAD's history turns that into a fork-point read, so the first move is read in full
		peerPushesMain('one');
		assert.strictEqual(await remeasure('main', before, fetchedMain), undefined);

		const diverged = await readFresh('main');
		assert.notStrictEqual(diverged.base?.forkPoint, diverged.base?.sha);
		peerPushesMain('two');
		const answer = await assertRemeasured('main', diverged, fetchedMain);
		assert.strictEqual(answer.base?.tier, 'upstream');
		assert.strictEqual(answer.base?.ahead, 1);
	});

	test('another ref the base depends on moving along with it is read in full', async () => {
		startTask('task', 1);
		const before = await readFresh('task');
		assert.ok(before.dependsOn.includes('refs/heads/main'));

		peerPushesMain('one');
		git(repo.path, 'branch', '-f', 'main', 'origin/main');

		assert.strictEqual(await remeasure('task', before, [...fetchedMain, 'refs/heads/main']), undefined);
		// Named alone, the same move is re-measured
		await assertRemeasured('task', before, fetchedMain);
	});

	test('a remote HEAD that moved elsewhere along with the base is read in full', async () => {
		addCommit(peer.path, 'other.txt', 'other', 'Other');
		git(peer.path, 'push', '-q', 'origin', 'HEAD:refs/heads/other');
		git(repo.path, 'fetch', '-q', 'origin');
		startTask('task', 1);
		const before = await readFresh('task');

		peerPushesMain('one');
		git(repo.path, 'remote', 'set-head', 'origin', 'other');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
	});

	test('a move that names the base without its tip moving, or that never names it, is read in full', async () => {
		startTask('task', 1);
		const before = await readFresh('task');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined, 'the tip is where it was');
		peerPushesMain('one');
		assert.strictEqual(await remeasure('task', before, [originHead]), undefined, 'only the symref is named');
	});

	test('a remote HEAD retargeted onto the base as it moves, changing the default branch, is read in full', async () => {
		// `origin/HEAD` first names `release`, at the same commit as `origin/main`
		git(peer.path, 'push', '-q', 'origin', 'main:refs/heads/release');
		git(repo.path, 'fetch', '-q', 'origin');
		git(repo.path, 'remote', 'set-head', 'origin', 'release');
		// Local `main` holds work `origin/main` lacks, and the task taken off `origin/main` was updated from it
		addCommit(repo.path, 'local.txt', 'local', 'Unpushed work');
		git(repo.path, 'checkout', '-q', '--no-track', '-b', 'task', 'origin/main');
		git(repo.path, 'merge', '-q', '--ff-only', 'main');
		addCommit(repo.path, 'task.txt', 'task', 'Task work');
		const before = await readFresh('task');
		assert.strictEqual(before.base?.ref, 'origin/main');
		assert.strictEqual(before.base?.tier, 'created');

		// The base fast-forwards while `origin/HEAD` is retargeted onto it: the listed `HEAD` is at the base's new tip
		// and names it, but the default branch is now `main`, which forked nearer
		peerPushesMain('one');
		git(repo.path, 'remote', 'set-head', 'origin', 'main');
		const fresh = await readFresh('task');
		assert.strictEqual(fresh.base?.ref, 'main');
		assert.strictEqual(fresh.base?.tier, 'default');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
	});

	test('a base move in a repository a shallow fetch cut since the last read is read in full', async () => {
		peerPushesMain('one');
		const oldest = git(repo.path, 'rev-list', '--max-parents=0', 'HEAD');
		// The task merges a line of work taken off before the commit it was created at
		startTask('task', 1);
		git(repo.path, 'checkout', '-q', '-b', 'side', oldest);
		addCommit(repo.path, 'side.txt', 'side', 'Side work');
		git(repo.path, 'checkout', '-q', 'task');
		git(repo.path, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
		const head = git(repo.path, 'rev-parse', 'HEAD');
		const before = await readFresh('task');
		assert.ok(before.base != null);
		assert.strictEqual(before.base.ahead, 3);

		peerPushesMain('two');
		const provider = createProvider();
		try {
			// git before 2.41 counts per tip and keeps each count by the pair of commits, as the complete history
			// decided it; then a shallow fetch cuts the base's history above the side line's start, so the count the
			// last read took, the kept one and every reflog entry's reach describe another history
			const target = provider.git;
			const supports = target.supports;
			target.supports = feature =>
				feature === 'git:for-each-ref:ahead-behind' ? false : supports.call(target, feature);
			await provider.branches.getAheadBehindCounts(repo.path, originMain, { refs: ['refs/heads/task'] });
			git(repo.path, 'fetch', '-q', '--depth=2', 'origin');
			assert.strictEqual(git(repo.path, 'rev-parse', '--is-shallow-repository'), 'true');

			const fresh = await readFresh('task');
			assert.notStrictEqual(fresh.base?.ahead, before.base?.ahead, 'the shallow history counts differently');

			const answer = await provider.branches.getAheadOfBaseAfterBaseMove(
				repo.path,
				'task',
				{ head: head, base: before.base, dependsOn: before.dependsOn, defaultBranch: before.defaultBranch },
				fetchedMain,
			);
			assert.strictEqual(answer, undefined);
		} finally {
			provider.dispose();
		}
	});

	test("a fork point the base's reflog no longer holds, once its entry expired, is read in full", async () => {
		const [own] = startTask('task', 1);
		const oldTip = git(repo.path, 'rev-parse', originMain);
		// The branch's commit landed and was force-pushed away, so the base's reflog puts the fork point there
		git(repo.path, 'push', '-q', 'origin', `${own}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');
		git(repo.path, 'push', '-q', '--force', 'origin', `${oldTip}:refs/heads/main`);
		git(repo.path, 'fetch', '-q', 'origin');
		const before = await readFresh('task');
		assert.strictEqual(before.base?.forkPoint, own);

		// Expiring the entries the base's tip can't reach (as `gc` does once they age) drops the one that held the
		// branch's commit, and then the base only fast-forwards: the count stands, the fork point doesn't
		git(repo.path, 'reflog', 'expire', '--expire-unreachable=now', originMain);
		peerPushesMain('one');
		const fresh = await readFresh('task');
		assert.strictEqual(fresh.base?.ahead, before.base?.ahead, 'the count is the same');
		assert.strictEqual(fresh.base?.forkPoint, oldTip, 'the fork point is not');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
	});

	test("an older reflog entry holding the branch's commit, left after another one expired, is read in full", async () => {
		// The branch merges two lines of work, `a` and `b`, each taken off `origin/main`
		startTask('task', 0);
		const oldTip = git(repo.path, 'rev-parse', 'HEAD');
		addCommit(repo.path, 'a.txt', 'a', 'Work a');
		const a = git(repo.path, 'rev-parse', 'HEAD');
		git(repo.path, 'checkout', '-q', '-b', 'side', oldTip);
		addCommit(repo.path, 'b.txt', 'b', 'Work b');
		const b = git(repo.path, 'rev-parse', 'HEAD');
		git(repo.path, 'checkout', '-q', 'task');
		git(repo.path, 'merge', '-q', '--no-ff', '-m', 'Merge b', 'side');

		// Each landed in the base and was force-pushed away in turn, and the base moved on: its reflog holds both before
		// the tip the summary reads, neither is the one fork point, and the merge base stands
		for (const own of [a, b]) {
			git(repo.path, 'push', '-q', 'origin', `${own}:refs/heads/main`);
			git(repo.path, 'fetch', '-q', 'origin');
			git(repo.path, 'push', '-q', '--force', 'origin', `${oldTip}:refs/heads/main`);
			git(repo.path, 'fetch', '-q', 'origin');
		}
		peerPushesMain('one');
		const before = await readFresh('task');
		assert.strictEqual(before.base?.forkPoint, oldTip);

		// `a`'s entry, the older, expires first (`@{0}` is the tip, `@{1}` the commit before, `@{2}` `b`, `@{3}` the
		// commit before, `@{4}` `a`), which leaves `b` the fork point, and then the base only fast-forwards
		git(repo.path, 'reflog', 'delete', `${originMain}@{4}`);
		peerPushesMain('two');
		const fresh = await readFresh('task');
		assert.strictEqual(fresh.base?.ahead, before.base?.ahead, 'the count is the same');
		assert.strictEqual(fresh.base?.forkPoint, b, 'the fork point is not');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
	});

	test("a branch's commit left only as the oldest reflog entry's old value, once the entries before it expired, is read in full", async () => {
		// The branch merges two lines of work, `a` and `b`, each taken off `origin/main`
		startTask('task', 0);
		const oldTip = git(repo.path, 'rev-parse', 'HEAD');
		addCommit(repo.path, 'a.txt', 'a', 'Work a');
		const a = git(repo.path, 'rev-parse', 'HEAD');
		git(repo.path, 'checkout', '-q', '-b', 'side', oldTip);
		addCommit(repo.path, 'b.txt', 'b', 'Work b');
		const b = git(repo.path, 'rev-parse', 'HEAD');
		git(repo.path, 'checkout', '-q', 'task');
		git(repo.path, 'merge', '-q', '--no-ff', '-m', 'Merge b', 'side');

		// `a` landed, `b` was force-pushed over it, and another user's work was force-pushed over that: the reflog holds
		// both, neither is the one fork point, and the merge base stands
		git(repo.path, 'push', '-q', 'origin', `${a}:refs/heads/main`);
		git(repo.path, 'push', '-q', '--force', 'origin', `${b}:refs/heads/main`);
		addCommit(peer.path, 'one.txt', 'one', 'Peer one');
		git(peer.path, 'push', '-q', '--force', 'origin', 'main');
		git(repo.path, 'fetch', '-q', 'origin');
		const before = await readFresh('task');
		assert.strictEqual(before.base?.forkPoint, oldTip);

		// Age-based expiry drops the oldest entries (`@{3}` the clone's, `@{2}` `a`'s, `@{1}` `b`'s), leaving the force-push
		// over `b` the oldest, whose old value `--fork-point` still reads although no entry lists it as a value. Then
		// the base only fast-forwards
		for (const entry of [3, 2, 1]) {
			git(repo.path, 'reflog', 'delete', `${originMain}@{${entry}}`);
		}
		peerPushesMain('two');
		const fresh = await readFresh('task');
		assert.strictEqual(fresh.base?.ahead, before.base?.ahead, 'the count is the same');
		assert.strictEqual(fresh.base?.forkPoint, b, 'the fork point is not');

		assert.strictEqual(await remeasure('task', before, fetchedMain), undefined);
	});

	/**
	 * A fetch moves one base under every worktree based on it, and each worktree's re-measure finds its HEAD's count in
	 * one shared `for-each-ref` rather than running a `rev-list` of its own, unless that count can't be shown to be
	 * the one the `rev-list` would give. Processes are told apart by the `• completed` line each logs.
	 */
	suite('across worktrees', () => {
		const completed: string[] = [];
		const logger: LogChannel = {
			name: 'spawn-counter',
			logLevel: 0,
			dispose: () => {},
			trace: () => {},
			debug: () => {},
			info: (msg: string) => {
				if (msg.includes('• completed')) {
					completed.push(msg);
				}
			},
			warn: () => {},
			error: () => {},
		};

		let worktrees: { path: string; cleanup: () => void }[];

		setup(() => {
			worktrees = [];
		});

		teardown(() => {
			for (const wt of worktrees) {
				wt.cleanup();
			}
		});

		/** Branch `name` taken off `origin/main` and checked out in a linked worktree, with `commits` of its own */
		function startWorktreeTask(name: string, commits: number): string {
			git(repo.path, 'branch', '--no-track', name, 'origin/main');
			const wt = createWorktree(repo.path, name);
			worktrees.push(wt);
			for (let i = 0; i < commits; i++) {
				addCommit(wt.path, `${name}-${i}.txt`, `${name} ${i}`, `${name} ${i}`);
			}
			return wt.path;
		}

		/** A linked worktree with a detached HEAD at `rev` (by its sha, which `git worktree add` checks out detached) */
		function addDetachedWorktree(rev: string): string {
			const wt = createWorktree(repo.path, git(repo.path, 'rev-parse', rev));
			worktrees.push(wt);
			return wt.path;
		}

		/** Moves `origin/main` to `sha`, as a push (forced or not) and this checkout's fetch would */
		function pushMain(sha: string, force?: boolean): void {
			git(repo.path, 'push', '-q', ...(force ? ['--force'] : []), 'origin', `${sha}:refs/heads/main`);
			git(repo.path, 'fetch', '-q', 'origin');
		}

		/** A new commit on `parent` with its tree, made without checking anything out */
		function commitOn(parent: string, message: string): string {
			return git(
				repo.path,
				'commit-tree',
				'-p',
				parent,
				'-m',
				message,
				git(repo.path, 'rev-parse', `${parent}^{tree}`),
			);
		}

		type Checkout = { readonly path: string; readonly branch: string | undefined };

		async function readAll(checkouts: readonly Checkout[]): Promise<AheadOfBase[]> {
			const answers: AheadOfBase[] = [];
			for (const { path, branch } of checkouts) {
				answers.push(await withProvider(p => p.branches.getAheadOfBase(path, branch)));
			}
			return answers;
		}

		/**
		 * Re-measures every checkout's previous answer through one provider, as one repository's summaries do, and holds
		 * each answer to a fresh full read (through the shadow check). Returns the answers, the processes the
		 * re-measures ran and the maintenance they asked for.
		 */
		async function remeasureAll(
			checkouts: readonly Checkout[],
			previous: readonly AheadOfBase[],
			moved: readonly string[],
			options?: {
				aheadBehind?: false;
				/** Runs after the first checkout's re-measure and before the others', which then run together */
				between?: (provider: CliGitProvider) => Promise<void>;
			},
		): Promise<{ answers: (AheadOfBase | undefined)[]; spawned: string[]; hinted: string[] }> {
			const provider = createProvider({ gitOptions: { logger: logger } });
			try {
				for (const path of [repo.path, ...checkouts.map(c => c.path)]) {
					provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
				}
				if (options?.aheadBehind === false) {
					const target = provider.git;
					const supports = target.supports;
					target.supports = feature =>
						feature === 'git:for-each-ref:ahead-behind' ? false : supports.call(target, feature);
				}
				const hinted: string[] = [];
				provider.maintenance!.request = (_path, task) => {
					hinted.push(task);
					return undefined;
				};

				const mark = completed.length;
				// Each wave takes its HEADs when it starts, as `between` may commit
				const measure = (indexes: readonly number[]): Promise<(AheadOfBase | undefined)[]> =>
					Promise.all(
						indexes.map(i => {
							const { path, branch } = checkouts[i];
							const before = previous[i];
							assert.ok(before.base != null, 'there is a base to re-measure');
							return provider.branches.getAheadOfBaseAfterBaseMove(
								path,
								branch,
								{
									head: git(path, 'rev-parse', 'HEAD'),
									base: before.base,
									dependsOn: before.dependsOn,
									...(before.defaultBranch !== undefined
										? { defaultBranch: before.defaultBranch }
										: undefined),
								},
								moved,
							);
						}),
					);

				let answers: (AheadOfBase | undefined)[];
				if (options?.between != null) {
					const first = await measure([0]);
					await options.between(provider);
					const rest = await measure(checkouts.map((_, i) => i).slice(1));
					answers = [...first, ...rest];
				} else {
					answers = await measure(checkouts.map((_, i) => i));
				}
				const spawned = completed.slice(mark);

				const fresh = await readAll(checkouts);
				for (const [i, answer] of answers.entries()) {
					if (answer != null) {
						verifyBaseRemeasure(answer, fresh[i]);
					}
				}
				return { answers: answers, spawned: spawned, hinted: hinted };
			} finally {
				provider.dispose();
			}
		}

		/** Forces a fresh ref list, as a ref write between two re-measures replaces the cached one */
		async function refListRefresh(provider: CliGitProvider): Promise<void> {
			await provider.refs.getRefs(repo.path, undefined, { force: true });
		}

		/** The reads of whether the base only moved forward, each of which starts with the base's reflog */
		function movedForwardReads(spawned: readonly string[]): string[] {
			return spawned.filter(m => m.includes(' reflog show '));
		}

		/** Three checkouts `a`, `b` and `c` based on `origin/main`, with 1, 2 and 3 commits of their own, and their answers */
		async function threeCheckouts(): Promise<{ checkouts: Checkout[]; before: AheadOfBase[] }> {
			const checkouts = ['a', 'b', 'c'].map((name, i) => ({
				path: startWorktreeTask(name, i + 1),
				branch: name,
			}));
			return { checkouts: checkouts, before: await readAll(checkouts) };
		}

		/** The shared counts of every local branch past a moved base */
		function sharedCounts(spawned: readonly string[]): string[] {
			return spawned.filter(m => m.includes(' for-each-ref ') && m.includes('%(ahead-behind:'));
		}

		/** The count `path`'s HEAD ran of its own */
		function ownCounts(spawned: readonly string[], path: string): string[] {
			const head = git(path, 'rev-parse', 'HEAD');
			return spawned.filter(m => m.includes(` rev-list --count ${head} --not `));
		}

		test('a base that moved forward under several worktrees is re-measured for all of them from one count', async () => {
			const checkouts = ['a', 'b', 'c'].map((name, i) => ({
				path: startWorktreeTask(name, i + 1),
				branch: name,
			}));
			const before = await readAll(checkouts);
			for (const answer of before) {
				assert.strictEqual(answer.base?.ref, 'origin/main');
			}

			peerPushesMain('one');
			let { answers, spawned, hinted } = await remeasureAll(checkouts, before, fetchedMain);
			assert.deepStrictEqual(
				answers.map(a => a?.base?.ahead),
				[1, 2, 3],
			);
			assert.strictEqual(sharedCounts(spawned).length, 1, spawned.join('\n'));
			for (const { path } of checkouts) {
				assert.deepStrictEqual(ownCounts(spawned, path), []);
			}
			assert.deepStrictEqual(hinted, ['commit-graph'], 'the shared count asks for a commit-graph');

			// And again from the re-measured answers, whose fork point is now an older entry of the base's reflog
			const remeasured = answers.map(a => a!);
			assert.notStrictEqual(remeasured[0].base?.forkPoint, remeasured[0].base?.sha);
			peerPushesMain('two');
			({ answers, spawned } = await remeasureAll(checkouts, remeasured, fetchedMain));
			assert.ok(answers.every(a => a != null));
			assert.strictEqual(sharedCounts(spawned).length, 1, spawned.join('\n'));
			for (const { path } of checkouts) {
				assert.deepStrictEqual(ownCounts(spawned, path), []);
			}
		});

		test("a branch created between two worktrees' re-measures shares the moved base's reads", async () => {
			const { checkouts, before } = await threeCheckouts();
			const old = git(repo.path, 'rev-parse', 'HEAD');

			peerPushesMain('one');
			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain, {
				between: async provider => {
					git(repo.path, 'branch', 'unrelated', old);
					await refListRefresh(provider);
				},
			});
			assert.deepStrictEqual(
				answers.map(a => a?.base?.ahead),
				[1, 2, 3],
			);
			assert.strictEqual(sharedCounts(spawned).length, 1, spawned.join('\n'));
			assert.strictEqual(movedForwardReads(spawned).length, 1, spawned.join('\n'));
			for (const { path } of checkouts) {
				assert.deepStrictEqual(ownCounts(spawned, path), []);
			}
		});

		test("a worktree added at the moved base between two worktrees' re-measures shares its reads", async () => {
			const { checkouts, before } = await threeCheckouts();
			const launched = join(root, 'launched');

			peerPushesMain('one');
			try {
				const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain, {
					between: async provider => {
						git(repo.path, 'worktree', 'add', '-q', '-b', 'launched', launched, 'origin/main');
						await refListRefresh(provider);
					},
				});
				assert.deepStrictEqual(
					answers.map(a => a?.base?.ahead),
					[1, 2, 3],
				);
				assert.strictEqual(sharedCounts(spawned).length, 1, spawned.join('\n'));
				assert.strictEqual(movedForwardReads(spawned).length, 1, spawned.join('\n'));
				for (const { path } of checkouts) {
					assert.deepStrictEqual(ownCounts(spawned, path), []);
				}
			} finally {
				if (existsSync(launched)) {
					git(repo.path, 'worktree', 'remove', '--force', launched);
				}
			}
		});

		test('a worktree whose HEAD the shared count did not cover starts another', async () => {
			const { checkouts, before } = await threeCheckouts();

			peerPushesMain('one');
			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain, {
				between: async provider => {
					git(checkouts[1].path, 'commit', '-q', '--allow-empty', '-m', 'X');
					await refListRefresh(provider);
				},
			});
			// `b` re-measures with the HEAD it has by then, which the first count never saw
			assert.ok(answers[0] != null);
			assert.strictEqual(sharedCounts(spawned).length, 2, spawned.join('\n'));
			for (const { path } of checkouts) {
				assert.deepStrictEqual(ownCounts(spawned, path), []);
			}
		});

		test("a base that moved away and back between two worktrees' re-measures reads its reflog again", async () => {
			const { checkouts, before } = await threeCheckouts();
			const oldTip = git(repo.path, 'rev-parse', originMain);

			const newTip = peerPushesMain('one');
			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain, {
				// A commit off the new tip's history, which the base's reflog now reaches. The ref list stays the one wave
				// 1 read, at the same tip, so only the reflog tells
				between: async () => {
					git(repo.path, 'update-ref', originMain, commitOn(oldTip, 'Away'));
					git(repo.path, 'update-ref', originMain, newTip);
				},
			});
			assert.ok(answers[0] != null);
			assert.strictEqual(movedForwardReads(spawned).length, 2, spawned.join('\n'));
			// Wave 2 reads the reflog again and finds it reaching a commit off the new tip's history, which the
			// re-measure declines
			assert.deepStrictEqual(
				answers.slice(1).map(a => a === undefined),
				[true, true],
			);
		});

		test("a replace ref created between two worktrees' re-measures restarts the shared reads", async () => {
			const { checkouts, before } = await threeCheckouts();
			const start = git(repo.path, 'rev-parse', originMain);
			const replaced = commitOn(start, 'Replaced');
			const replacement = commitOn(start, 'Replacement');

			peerPushesMain('one');
			try {
				const { spawned } = await remeasureAll(checkouts, before, fetchedMain, {
					between: async provider => {
						git(repo.path, 'replace', replaced, replacement);
						await refListRefresh(provider);
					},
				});
				assert.strictEqual(sharedCounts(spawned).length, 2, spawned.join('\n'));
				assert.strictEqual(movedForwardReads(spawned).length, 2, spawned.join('\n'));
			} finally {
				git(repo.path, 'replace', '-d', replaced);
			}
		});

		test('a worktree whose branch landed in the moved base is read in full, the others re-measured', async () => {
			const checkouts = ['a', 'b', 'c'].map(name => ({ path: startWorktreeTask(name, 1), branch: name }));
			const before = await readAll(checkouts);

			git(repo.path, 'push', '-q', 'origin', 'b');
			git(peer.path, 'fetch', '-q', 'origin', 'b');
			git(peer.path, 'merge', '-q', '--no-ff', '-m', 'Merge b', 'FETCH_HEAD');
			git(peer.path, 'push', '-q', 'origin', 'main');
			git(repo.path, 'fetch', '-q', 'origin');

			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain);
			assert.ok(answers[0] != null);
			assert.strictEqual(answers[1], undefined);
			assert.ok(answers[2] != null);
			assert.strictEqual((await readAll([checkouts[1]]))[0].base?.ahead, 0);
			// The shared count already differs from the previous one, so no worktree counts its own
			assert.strictEqual(sharedCounts(spawned).length, 1, spawned.join('\n'));
			for (const { path } of checkouts) {
				assert.deepStrictEqual(ownCounts(spawned, path), []);
			}
		});

		test("commits the base's reflog reaches off its new tip's history make each worktree count its own", async () => {
			// The base held a commit that a force-push then left behind, before the worktrees' branches were taken off it
			const start = git(repo.path, 'rev-parse', originMain);
			pushMain(commitOn(start, 'Dropped'));
			const oldTip = commitOn(start, 'Kept');
			pushMain(oldTip, true);
			const checkouts = ['a', 'b'].map(name => ({ path: startWorktreeTask(name, 1), branch: name }));
			const before = await readAll(checkouts);
			assert.strictEqual(before[0].base?.forkPoint, oldTip);

			pushMain(commitOn(oldTip, 'Moved'));
			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain);
			assert.ok(answers.every(a => a != null));
			assert.strictEqual(sharedCounts(spawned).length, 1, spawned.join('\n'));
			for (const { path } of checkouts) {
				assert.strictEqual(ownCounts(spawned, path).length, 1, spawned.join('\n'));
			}
		});

		test("a fork point the base's reflog no longer holds makes the worktree count its own", async () => {
			const checkouts = [{ path: startWorktreeTask('a', 1), branch: 'a' }];
			const forkPoint = git(repo.path, 'rev-parse', originMain);
			peerPushesMain('one');
			peerPushesMain('two');
			const before = await readAll(checkouts);
			assert.strictEqual(before[0].base?.forkPoint, forkPoint);

			// Expiry drops the entries holding the fork point (`@{2}`) and the commit after it (`@{1}`), which the oldest
			// entry left still names as the value before it; the base then only fast-forwards
			git(repo.path, 'reflog', 'delete', `${originMain}@{2}`);
			git(repo.path, 'reflog', 'delete', `${originMain}@{1}`);
			peerPushesMain('three');

			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain);
			assert.ok(answers[0] != null);
			assert.strictEqual(answers[0].base?.forkPoint, forkPoint);
			assert.strictEqual(sharedCounts(spawned).length, 1, spawned.join('\n'));
			assert.strictEqual(ownCounts(spawned, checkouts[0].path).length, 1, spawned.join('\n'));
		});

		test("a detached HEAD at a branch's commit uses the shared count, and one at a commit no branch points at counts its own", async () => {
			const branched = startWorktreeTask('a', 1);
			const atBranch = addDetachedWorktree('a');
			const unbranched = addDetachedWorktree('a');
			addCommit(unbranched, 'detached.txt', 'detached', 'Detached work');
			const checkouts = [
				{ path: branched, branch: 'a' },
				{ path: atBranch, branch: undefined },
				{ path: unbranched, branch: undefined },
			];
			const before = await readAll(checkouts);
			for (const answer of before) {
				assert.strictEqual(answer.base?.ref, 'origin/main');
			}

			peerPushesMain('one');
			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain);
			assert.ok(answers.every(r => r != null));
			assert.strictEqual(sharedCounts(spawned).length, 1, spawned.join('\n'));
			assert.deepStrictEqual(ownCounts(spawned, branched), []);
			assert.deepStrictEqual(ownCounts(spawned, atBranch), []);
			assert.strictEqual(ownCounts(spawned, unbranched).length, 1, spawned.join('\n'));
		});

		test('a detached HEAD at the commit of a branch no worktree has checked out counts its own', async () => {
			const branched = startWorktreeTask('a', 1);
			const tip = commitOn(git(repo.path, 'rev-parse', originMain), 'Parked');
			git(repo.path, 'branch', '--no-track', 'parked', tip);
			const atParked = addDetachedWorktree(tip);
			const checkouts = [
				{ path: branched, branch: 'a' },
				{ path: atParked, branch: undefined },
			];
			const before = await readAll(checkouts);
			for (const answer of before) {
				assert.strictEqual(answer.base?.ref, 'origin/main');
			}

			peerPushesMain('one');
			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain);
			assert.ok(answers.every(r => r != null));
			const shared = sharedCounts(spawned);
			assert.strictEqual(shared.length, 1, spawned.join('\n'));
			assert.ok(!shared[0].includes('refs/heads/parked'), shared[0]);
			assert.deepStrictEqual(ownCounts(spawned, branched), []);
			assert.strictEqual(ownCounts(spawned, atParked).length, 1, spawned.join('\n'));
		});

		test('a branch no worktree has checked out, an orphan one included, is left out of the shared count', async () => {
			const checkouts = ['a', 'b'].map(name => ({ path: startWorktreeTask(name, 1), branch: name }));
			// The empty tree is built into git, so the root commit needs no tree written
			const orphan = git(repo.path, 'commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'Orphan');
			git(repo.path, 'branch', '--no-track', 'gh-pages', orphan);
			git(repo.path, 'branch', '--no-track', 'old', git(repo.path, 'rev-list', '--max-parents=0', originMain));
			const before = await readAll(checkouts);

			peerPushesMain('one');
			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain);
			assert.deepStrictEqual(
				answers.map(a => a?.base?.ahead),
				[1, 1],
			);
			const shared = sharedCounts(spawned);
			assert.strictEqual(shared.length, 1, spawned.join('\n'));
			assert.ok(shared[0].includes('refs/heads/a') && shared[0].includes('refs/heads/b'), shared[0]);
			assert.ok(!shared[0].includes('gh-pages') && !shared[0].includes('refs/heads/old'), shared[0]);
			for (const { path } of checkouts) {
				assert.deepStrictEqual(ownCounts(spawned, path), []);
			}
		});

		test('two branches at one commit share its count', async () => {
			const a = startWorktreeTask('a', 1);
			const b = startWorktreeTask('b', 0);
			git(b, 'merge', '-q', '--ff-only', 'a');
			const checkouts = [
				{ path: a, branch: 'a' },
				{ path: b, branch: 'b' },
			];
			const before = await readAll(checkouts);
			assert.deepStrictEqual(
				before.map(r => r.base?.ref),
				['origin/main', 'origin/main'],
			);

			peerPushesMain('one');
			const { answers, spawned } = await remeasureAll(checkouts, before, fetchedMain);
			assert.ok(answers.every(r => r != null));
			assert.strictEqual(sharedCounts(spawned).length, 1, spawned.join('\n'));
			assert.deepStrictEqual(ownCounts(spawned, a), []);
		});

		test('git that cannot count every branch in one pass counts each worktree on its own', async () => {
			const checkouts = ['a', 'b'].map(name => ({ path: startWorktreeTask(name, 1), branch: name }));
			const before = await readAll(checkouts);

			peerPushesMain('one');
			const { answers, spawned, hinted } = await remeasureAll(checkouts, before, fetchedMain, {
				aheadBehind: false,
			});
			assert.ok(answers.every(r => r != null));
			assert.deepStrictEqual(sharedCounts(spawned), []);
			for (const { path } of checkouts) {
				assert.strictEqual(ownCounts(spawned, path).length, 1, spawned.join('\n'));
			}
			assert.deepStrictEqual(hinted, []);
		});
	});

	suite('through the summary', () => {
		let service: GitService;
		let watchers: { basePath: string; fire: (event: FileWatchEvent) => void }[];
		let calls: { full: number; remeasured: number; answered: number };

		setup(() => {
			watchers = [];
			calls = { full: 0, remeasured: 0, answered: 0 };
			service = createCliGitService({
				context: { fs: fs, config: noCommitGraphWritesConfig },
				watchingProvider: {
					createWatcher: function (basePath, _pattern, onEvent) {
						watchers.push({ basePath: basePath, fire: onEvent });
						return createDisposable(() => {});
					},
				},
				// Shadow-checked, but the full read it makes isn't one the summary needed, so it isn't counted
				verifyBaseRemeasure: (remeasured, full) => {
					calls.full--;
					verifyBaseRemeasure(remeasured, full);
				},
			});

			// Counted before any repository service binds the methods
			const branches = (service.getProvider(repo.path)!.provider as CliGitProvider).branches;
			const getAheadOfBase = branches.getAheadOfBase.bind(branches);
			const getAheadOfBaseAfterBaseMove = branches.getAheadOfBaseAfterBaseMove.bind(branches);
			branches.getAheadOfBase = (...args) => {
				calls.full++;
				return getAheadOfBase(...args);
			};
			branches.getAheadOfBaseAfterBaseMove = async (...args) => {
				calls.remeasured++;
				const answer = await getAheadOfBaseAfterBaseMove(...args);
				if (answer != null) {
					calls.answered++;
				}
				return answer;
			};
		});

		teardown(() => {
			service.dispose();
		});

		async function subscribeTask(): Promise<WorktreeSummarySubscription> {
			startTask('task', 1);
			const sub = service.summaries!.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
			await service.summaries!.getSummary(repo.path);
			calls = { full: 0, remeasured: 0, answered: 0 };
			return sub;
		}

		test('a fetch moving the base re-measures it, to the fresh answer', async () => {
			const sub = await subscribeTask();
			addCommit(peer.path, 'one.txt', 'one', 'Peer one');
			git(peer.path, 'push', '-q', 'origin', 'main');

			const changed = nextChange(sub);
			await service.forRepo(repo.path)!.ops!.fetch({ remote: 'origin' });
			const summary = await changed;

			assert.deepStrictEqual(calls, { full: 0, remeasured: 1, answered: 1 });
			const fresh = await readFresh('task');
			assert.deepStrictEqual(summary.base, fresh.base);
			assert.deepStrictEqual(summary.baseDependsOn, fresh.dependsOn);
			sub.dispose();
		});

		test('a fetch moving the base of a worktree without a subscription re-measures it, to the fresh answer', async () => {
			startTask('task', 1);
			const summaries = service.summaries!;
			const before = await summaries.getSummary(repo.path);
			assert.strictEqual(watchers.length, 0, 'nothing watches the worktree');
			calls = { full: 0, remeasured: 0, answered: 0 };
			assert.strictEqual(
				await summaries.getSummary(repo.path),
				before,
				'nothing moved, so the last read answers',
			);
			assert.deepStrictEqual(calls, { full: 0, remeasured: 0, answered: 0 });

			addCommit(peer.path, 'one.txt', 'one', 'Peer one');
			git(peer.path, 'push', '-q', 'origin', 'main');
			await service.forRepo(repo.path)!.ops!.fetch({ remote: 'origin' });
			const summary = await summaries.getSummary(repo.path);

			assert.deepStrictEqual(calls, { full: 0, remeasured: 1, answered: 1 });
			const fresh = await readFresh('task');
			assert.notStrictEqual(summary.base?.sha, before.base?.sha, 'the base moved');
			assert.deepStrictEqual(summary.base, fresh.base);
			assert.deepStrictEqual(summary.baseDependsOn, fresh.dependsOn);
		});

		test('a packed-refs rewrite that moved the base reads it in full', async () => {
			const sub = await subscribeTask();
			addCommit(peer.path, 'one.txt', 'one', 'Peer one');
			git(peer.path, 'push', '-q', 'origin', 'main');
			git(repo.path, 'fetch', '-q', 'origin');
			git(repo.path, 'pack-refs', '--all');

			const changed = nextChange(sub);
			const gitDir = watchers.find(w => w.basePath.endsWith('.git'))?.basePath;
			assert.ok(gitDir != null);
			watchers.find(w => w.basePath === gitDir)!.fire({ path: join(gitDir, 'packed-refs'), reason: 'change' });
			const summary = await changed;

			assert.strictEqual(calls.remeasured, 0, 'an unnamed ref change is not re-measured');
			assert.ok(calls.full >= 1);
			assert.deepStrictEqual(summary.base, (await readFresh('task')).base);
			sub.dispose();
		});
	});
});
