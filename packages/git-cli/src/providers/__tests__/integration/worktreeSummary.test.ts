import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { GitService } from '@gitlens/git/service.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import type { WorktreeSummary, WorktreeSummarySubscription } from '@gitlens/git/watching/worktreeSummary.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, toFsPath } from '@gitlens/utils/uri.js';
import { CliGitProvider } from '../../../cliGitProvider.js';
import { createCliGitService } from '../../../service.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

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
		service = createCliGitService({ context: { fs: fs }, watchingProvider: watchingProvider });
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
