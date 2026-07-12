import * as assert from 'assert';
import * as sinon from 'sinon';
import type { TestRepo } from './helpers.js';
import { addCommit, createBranch, createTestRepo } from './helpers.js';

suite('BranchesSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		// Create some branches
		createBranch(repo.path, 'feature/test-1');
		createBranch(repo.path, 'feature/test-2');
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
		createBranch(repo.path, 'feature/test-3');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getBranches returns all branches', async () => {
		const result = await repo.provider.branches.getBranches(repo.path);
		assert.ok(result.values.length >= 4, `Expected at least 4 branches, got ${result.values.length}`);

		const names = result.values.map(b => b.name);
		assert.ok(names.includes('main'), 'Should include main');
		assert.ok(names.includes('feature/test-1'), 'Should include feature/test-1');
		assert.ok(names.includes('feature/test-2'), 'Should include feature/test-2');
		assert.ok(names.includes('feature/test-3'), 'Should include feature/test-3');
	});

	test('getBranches identifies current branch', async () => {
		const result = await repo.provider.branches.getBranches(repo.path);
		const current = result.values.find(b => b.current);
		assert.ok(current, 'Should have a current branch');
		assert.strictEqual(current.name, 'main');
	});

	test('getBranch returns a specific branch', async () => {
		const branch = await repo.provider.branches.getBranch(repo.path, 'feature/test-1');
		assert.ok(branch, 'Should find feature/test-1');
		assert.strictEqual(branch.name, 'feature/test-1');
	});

	test('getBranch returns undefined for nonexistent branch', async () => {
		const branch = await repo.provider.branches.getBranch(repo.path, 'nonexistent');
		assert.strictEqual(branch, undefined);
	});

	test('getBranches supports filtering', async () => {
		const result = await repo.provider.branches.getBranches(repo.path, {
			filter: b => b.name.startsWith('feature/'),
		});
		assert.ok(result.values.length >= 3, `Expected at least 3 feature branches, got ${result.values.length}`);
		for (const b of result.values) {
			assert.ok(b.name.startsWith('feature/'), `Branch ${b.name} should start with feature/`);
		}
	});
});

suite('BranchesSubProvider.getBranchMergedStatus caching', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		// `feature` never moves past the initial commit, so it's trivially an ancestor of every
		// later `main` commit — `merge-base --is-ancestor` succeeds on the very first check.
		createBranch(repo.path, 'feature');
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	function countMergeBaseCalls(spy: sinon.SinonSpy): number {
		return spy.getCalls().filter(c => c.args[1] === 'merge-base' && c.args[2] === '--is-ancestor').length;
	}

	test('same tips are served from cache; a tip advance recomputes', async () => {
		const runSpy = sinon.spy(repo.provider.git, 'run');
		try {
			const feature = await repo.provider.branches.getBranch(repo.path, 'feature');
			const main = await repo.provider.branches.getBranch(repo.path, 'main');
			assert.ok(feature && main);

			const first = await repo.provider.branches.getBranchMergedStatus(repo.path, feature, main);
			assert.strictEqual(first.merged, true);
			assert.strictEqual(countMergeBaseCalls(runSpy), 1, 'first call should compute');

			// Same tips (as if an unrelated branch elsewhere had gained a commit) — cache hit.
			const second = await repo.provider.branches.getBranchMergedStatus(repo.path, feature, main);
			assert.strictEqual(second.merged, true);
			assert.strictEqual(countMergeBaseCalls(runSpy), 1, 'repeat call with the same tips should be cached');

			// Advance main's tip — new key, so it recomputes. The test harness bypasses GitLens's
			// change hooks, so force the (unrelated) branches cache to refresh and pick up the move.
			addCommit(repo.path, 'file2.txt', 'more content', 'Third commit');
			repo.provider.cache.clearCaches(repo.path, 'branches');
			const mainAdvanced = await repo.provider.branches.getBranch(repo.path, 'main');
			assert.ok(mainAdvanced && mainAdvanced.sha !== main.sha);

			const third = await repo.provider.branches.getBranchMergedStatus(repo.path, feature, mainAdvanced);
			assert.strictEqual(third.merged, true);
			assert.strictEqual(countMergeBaseCalls(runSpy), 2, 'a tip advance should bust the cache and recompute');
		} finally {
			runSpy.restore();
		}
	});
});
