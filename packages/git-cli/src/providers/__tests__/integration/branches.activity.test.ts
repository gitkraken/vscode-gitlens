import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as sinon from 'sinon';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { TestRepo } from './helpers.js';
import { addCommit, createBranch, createTestRepo, createWorktree, gkConfig } from './helpers.js';

function currentBranch(repoPath: string): string {
	return execFileSync('git', ['branch', '--show-current'], { cwd: repoPath, encoding: 'utf-8' }).trim();
}

suite('BranchesSubProvider.onCurrentBranchModified', () => {
	const repos: TestRepo[] = [];

	function newRepo(): TestRepo {
		const repo = createTestRepo();
		repos.push(repo);
		return repo;
	}

	suiteTeardown(() => {
		for (const repo of repos) {
			repo.cleanup();
		}
	});

	test('stamps every repository one provider stamps back-to-back', async () => {
		const a = newRepo();
		const b = newRepo();

		// One provider for both, as a host has: its sub-provider is shared by every repository it serves
		await Promise.all([
			a.provider.branches.onCurrentBranchModified(a.path),
			a.provider.branches.onCurrentBranchModified(b.path),
		]);

		for (const repo of [a, b]) {
			const name = currentBranch(repo.path);
			assert.ok(gkConfig(repo.path, `branch.${name}.gk-last-modified`));
			assert.ok(gkConfig(repo.path, `branch.${name}.gk-last-accessed`));
		}
	});

	test('does not restamp within 5 minutes', async () => {
		const repo = newRepo();
		const name = currentBranch(repo.path);

		await repo.provider.branches.onCurrentBranchModified(repo.path);
		const first = gkConfig(repo.path, `branch.${name}.gk-last-modified`);
		assert.ok(first);

		await new Promise(resolve => setTimeout(resolve, 20));
		await repo.provider.branches.onCurrentBranchModified(repo.path);
		assert.strictEqual(gkConfig(repo.path, `branch.${name}.gk-last-modified`), first);
	});

	test('settles a call held off by a stamp still being written only once it is stored', async () => {
		const repo = newRepo();
		const name = currentBranch(repo.path);

		const first = repo.provider.branches.onCurrentBranchAccessed(repo.path);
		await repo.provider.branches.onCurrentBranchAccessed(repo.path);
		assert.ok(gkConfig(repo.path, `branch.${name}.gk-last-accessed`));
		await first;
	});

	test('writes nothing on a detached HEAD', async () => {
		const repo = newRepo();
		const name = currentBranch(repo.path);
		addCommit(repo.path, 'd.txt', 'd', 'second');
		execFileSync('git', ['checkout', '--detach', 'HEAD~1'], { cwd: repo.path, stdio: 'pipe' });

		await repo.provider.branches.onCurrentBranchModified(repo.path);
		await repo.provider.branches.onCurrentBranchAccessed(repo.path);
		await repo.provider.branches.onCurrentBranchAgentActivity(repo.path);

		for (const key of ['gk-last-accessed', 'gk-last-modified', 'gk-agent-last-activity']) {
			assert.strictEqual(gkConfig(repo.path, `branch.${name}.${key}`), undefined);
			assert.strictEqual(gkConfig(repo.path, `branch.HEAD.${key}`), undefined);
		}
	});

	test('stamps a recreated branch of the same name within 5 minutes of the deleted one', async () => {
		const repo = newRepo();
		const main = currentBranch(repo.path);
		createBranch(repo.path, 'recreated', { checkout: true });

		await repo.provider.branches.onCurrentBranchAccessed(repo.path);
		assert.ok(gkConfig(repo.path, 'branch.recreated.gk-last-accessed'));

		execFileSync('git', ['checkout', main], { cwd: repo.path, stdio: 'pipe' });
		await repo.provider.branches.deleteLocalBranch(repo.path, 'recreated', { force: true });
		assert.strictEqual(gkConfig(repo.path, 'branch.recreated.gk-last-accessed'), undefined);

		createBranch(repo.path, 'recreated', { checkout: true });
		await repo.provider.branches.onCurrentBranchAccessed(repo.path);
		assert.ok(gkConfig(repo.path, 'branch.recreated.gk-last-accessed'));
	});

	test('does not retry a failed stamp within 5 minutes', async () => {
		const repo = newRepo();
		const lockPath = join(repo.path, '.git', 'gk', 'config.lock');
		mkdirSync(join(lockPath, '..'), { recursive: true });
		writeFileSync(lockPath, '');
		try {
			const branches = repo.provider.branches;
			await assert.doesNotReject(branches.onCurrentBranchModified(repo.path));

			const run = sinon.spy(repo.provider.git, 'run');
			await assert.doesNotReject(branches.onCurrentBranchModified(repo.path));
			const writes = run
				.getCalls()
				.filter(call => call.args[1] === 'config' && !call.args.includes('--get-regex'));
			assert.strictEqual(writes.length, 0);
		} finally {
			rmSync(lockPath, { force: true });
		}
	});

	test('a stamp reaches branches already read, in sibling worktrees too', async () => {
		const repo = newRepo();
		const name = currentBranch(repo.path);
		createBranch(repo.path, 'sibling');
		const worktree = createWorktree(repo.path, 'sibling');
		try {
			for (const path of [repo.path, worktree.path]) {
				repo.provider.cache.registerRepoPath(fileUri(path), await repo.provider.config.getGitDir(path));
			}

			const branches = repo.provider.branches;
			const readFromSibling = async () =>
				(await branches.getBranches(worktree.path)).values.find(b => b.name === name);

			assert.strictEqual((await branches.getBranch(repo.path))?.lastModifiedDate, undefined);
			assert.strictEqual((await readFromSibling())?.lastModifiedDate, undefined);

			await branches.onCurrentBranchModified(repo.path);

			const stored = gkConfig(repo.path, `branch.${name}.gk-last-modified`);
			assert.ok(stored);
			assert.strictEqual((await branches.getBranch(repo.path))?.lastModifiedDate?.toISOString(), stored);
			assert.strictEqual((await readFromSibling())?.lastModifiedDate?.toISOString(), stored);
		} finally {
			worktree.cleanup();
		}
	});
});

/** A branch-activity stamp another process (Kepler, or another window) writes to the shared `.git/gk/config` */
suite('BranchesSubProvider — branch activity stamped by another process', () => {
	let repo: TestRepo;

	/** Writes `key` from outside the provider, as another process would */
	function writeExternally(key: string, value: string): void {
		const gkConfigPath = join(repo.path, '.git', 'gk', 'config');
		mkdirSync(join(gkConfigPath, '..'), { recursive: true });
		execFileSync('git', ['config', '-f', gkConfigPath, key, value], { cwd: repo.path, stdio: 'pipe' });
	}

	/** Reports the file change the way the watcher would, then waits out the async reconcile */
	async function reportGkConfigChange(): Promise<void> {
		repo.provider.cache.onRepositoryChanged(normalizePath(repo.path), ['gkConfig']);
		await new Promise(resolve => setTimeout(resolve, 300));
	}

	setup(() => {
		repo = createTestRepo();
	});

	teardown(() => {
		sinon.restore();
		repo.cleanup();
	});

	test('reaches branches already read once the watcher reports it', async () => {
		const branches = repo.provider.branches;
		const name = currentBranch(repo.path);
		assert.strictEqual((await branches.getBranch(repo.path))?.lastAccessedDate, undefined);
		assert.strictEqual(
			(await branches.getBranches(repo.path)).values.find(b => b.name === name)?.lastAccessedDate,
			undefined,
		);

		const stamp = '2026-10-05T00:00:00.000Z';
		writeExternally(`branch.${name}.gk-last-accessed`, stamp);
		await reportGkConfigChange();

		assert.strictEqual((await branches.getBranch(repo.path))?.lastAccessedDate?.toISOString(), stamp);
		assert.strictEqual(
			(await branches.getBranches(repo.path)).values.find(b => b.name === name)?.lastAccessedDate?.toISOString(),
			stamp,
		);
	});

	test("core's own stamp evicts the branches once, not again for the watcher's report of it", async () => {
		const branches = repo.provider.branches;
		const name = currentBranch(repo.path);
		await branches.getBranch(repo.path);

		const deleteBranchMetadata = sinon.spy(repo.provider.cache, 'deleteBranchMetadata');
		await branches.onCurrentBranchAccessed(repo.path);
		assert.strictEqual(deleteBranchMetadata.callCount, 1);

		await reportGkConfigChange();
		assert.strictEqual(deleteBranchMetadata.callCount, 1, "the watcher's report of core's own stamp is not new");
		assert.strictEqual(
			(await branches.getBranch(repo.path))?.lastAccessedDate?.toISOString(),
			gkConfig(repo.path, `branch.${name}.gk-last-accessed`),
		);
	});
});
