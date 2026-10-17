import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import type { TestRepo } from './helpers.js';
import { addCommit, checkout, createBranch, createTestRepo, getHeadSha } from './helpers.js';

function git(repoPath: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
}

suite('BranchesSubProvider.getMergedBranches', () => {
	let repo: TestRepo;
	let mainName: string;

	suiteSetup(() => {
		repo = createTestRepo();
		mainName = execFileSync('git', ['branch', '--show-current'], { cwd: repo.path, encoding: 'utf-8' }).trim();

		// ff: main fast-forwards past its tip, so ff's tip is an ancestor of main
		createBranch(repo.path, 'ff', { checkout: true });
		addCommit(repo.path, 'f.txt', 'f', 'ff 1');
		checkout(repo.path, mainName);
		git(repo.path, 'merge', '--ff-only', 'ff');

		// merged: diverged, then merged into main with a merge commit
		createBranch(repo.path, 'merged', { checkout: true });
		addCommit(repo.path, 'g.txt', 'g', 'merged 1');
		const mergedSha = getHeadSha(repo.path);
		checkout(repo.path, mainName);
		addCommit(repo.path, 'm.txt', 'm', 'main 1');
		git(repo.path, 'merge', '--no-ff', '-m', 'Merge merged', 'merged');

		createBranch(repo.path, 'same');

		// open: unmerged
		createBranch(repo.path, 'open', { checkout: true });
		addCommit(repo.path, 'o.txt', 'o', 'open 1');
		const openSha = getHeadSha(repo.path);
		checkout(repo.path, mainName);

		git(repo.path, 'update-ref', 'refs/remotes/origin/merged', mergedSha);
		git(repo.path, 'update-ref', 'refs/remotes/origin/open', openSha);
		git(repo.path, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/merged');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	function run(options?: { remotes?: boolean }, into?: string) {
		return repo.provider.branches.getMergedBranches(repo.path, into ?? mainName, options);
	}

	test('lists merged local branches only by default', async () => {
		const merged = await run();
		assert.deepStrictEqual(
			[...merged].sort(),
			['ff', 'merged', 'same', mainName].map(n => `refs/heads/${n}`).sort(),
		);
	});

	test('includes merged remote branches, never symbolic refs', async () => {
		const merged = await run({ remotes: true });
		assert.ok(merged.has('refs/remotes/origin/merged'));
		assert.ok(!merged.has('refs/remotes/origin/open'));
		assert.ok(!merged.has('refs/remotes/origin/HEAD'));
		assert.ok(!merged.has('refs/heads/open'));
		assert.strictEqual(merged.size, 5);
	});

	test('rejects on a bad into', async () => {
		await assert.rejects(run(undefined, 'no-such-ref'));
		await assert.rejects(run({ remotes: true }, '--no-such-flag'));
	});
});
