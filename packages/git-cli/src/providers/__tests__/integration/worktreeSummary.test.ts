import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { GitService } from '@gitlens/git/service.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import type { WorktreeSummary, WorktreeSummarySubscription } from '@gitlens/git/watching/worktreeSummary.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { toFsPath } from '@gitlens/utils/uri.js';
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
