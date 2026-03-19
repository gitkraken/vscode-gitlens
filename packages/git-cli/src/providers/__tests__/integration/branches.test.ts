import * as assert from 'assert';
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
