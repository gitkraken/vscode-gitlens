import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { addCommit, createTestRepo, getHeadSha } from './helpers.js';

suite('CommitsSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		// Add several commits with known content
		addCommit(repo.path, 'file1.txt', 'hello', 'Add file1', { date: '2024-02-01T00:00:00Z' });
		addCommit(repo.path, 'file2.txt', 'world', 'Add file2', { date: '2024-03-01T00:00:00Z' });
		addCommit(repo.path, 'file1.txt', 'hello updated', 'Update file1', { date: '2024-04-01T00:00:00Z' });
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getLog returns commits', async () => {
		const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: 10 });
		assert.ok(log, 'Log should not be undefined');
		assert.ok(log.count >= 4, `Expected at least 4 commits, got ${log.count}`);
	});

	test('getLog respects limit', async () => {
		const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: 2 });
		assert.ok(log, 'Log should not be undefined');
		assert.strictEqual(log.count, 2);
		assert.strictEqual(log.hasMore, true);
	});

	test('getCommit returns a specific commit', async () => {
		const sha = getHeadSha(repo.path);
		const commit = await repo.provider.commits.getCommit(repo.path, sha);
		assert.ok(commit, 'Should find HEAD commit');
		assert.strictEqual(commit.sha, sha);
		assert.ok(commit.message?.includes('Update file1'), `Expected message about file1, got: ${commit.message}`);
	});

	test('getCommit resolves HEAD', async () => {
		const commit = await repo.provider.commits.getCommit(repo.path, 'HEAD');
		assert.ok(commit, 'Should resolve HEAD');
		const sha = getHeadSha(repo.path);
		assert.strictEqual(commit.sha, sha);
	});

	test('commits have author information', async () => {
		const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: 1 });
		assert.ok(log, 'Log should not be undefined');
		const commit = [...log.commits.values()][0];
		assert.ok(commit, 'Should have at least one commit');
		assert.ok(commit.author.name, 'Author should have a name');
		assert.ok(commit.author.email, 'Author should have an email');
		assert.ok(commit.author.date instanceof Date, 'Author date should be a Date');
	});

	test('commits have parent information', async () => {
		const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: 2 });
		assert.ok(log, 'Log should not be undefined');
		const commits = [...log.commits.values()];
		// Most recent commit should have a parent
		assert.ok(commits[0].parents.length > 0, 'HEAD commit should have parents');
	});

	test('getCommitCount returns correct count', async () => {
		const count = await repo.provider.commits.getCommitCount(repo.path, 'HEAD');
		assert.ok(count != null, 'Count should not be undefined');
		assert.ok(count >= 4, `Expected at least 4 commits, got ${count}`);
	});

	test('isAncestorOf works correctly', async () => {
		const isAncestor = await repo.provider.commits.isAncestorOf(repo.path, 'HEAD~1', 'HEAD');
		assert.strictEqual(isAncestor, true, 'HEAD~1 should be ancestor of HEAD');

		const notAncestor = await repo.provider.commits.isAncestorOf(repo.path, 'HEAD', 'HEAD~1');
		assert.strictEqual(notAncestor, false, 'HEAD should not be ancestor of HEAD~1');
	});
});
