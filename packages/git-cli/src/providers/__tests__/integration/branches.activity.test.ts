import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { TestRepo } from './helpers.js';
import { addCommit, createBranch, createTestRepo, gkConfig } from './helpers.js';

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
});
