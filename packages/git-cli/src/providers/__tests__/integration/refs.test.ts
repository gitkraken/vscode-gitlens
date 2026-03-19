import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { addCommit, createBranch, createTag, createTestRepo, getHeadSha } from './helpers.js';

suite('RefsSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
		createBranch(repo.path, 'feature/refs-test');
		createTag(repo.path, 'v1.0.0');
		addCommit(repo.path, 'file2.txt', 'content', 'Third commit');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('isValidReference validates HEAD', async () => {
		const valid = await repo.provider.refs.isValidReference(repo.path, 'HEAD');
		assert.strictEqual(valid, true);
	});

	test('isValidReference validates a branch name', async () => {
		const valid = await repo.provider.refs.isValidReference(repo.path, 'main');
		assert.strictEqual(valid, true);
	});

	test('isValidReference validates a tag name', async () => {
		const valid = await repo.provider.refs.isValidReference(repo.path, 'v1.0.0');
		assert.strictEqual(valid, true);
	});

	test('isValidReference rejects invalid refs', async () => {
		const valid = await repo.provider.refs.isValidReference(repo.path, 'nonexistent-ref-12345');
		assert.strictEqual(valid, false);
	});

	test('getMergeBase finds common ancestor', async () => {
		const mergeBase = await repo.provider.refs.getMergeBase(repo.path, 'main', 'feature/refs-test');
		assert.ok(mergeBase, 'Should find merge base');
		assert.ok(mergeBase.length >= 7, 'Merge base should be a valid sha');
	});

	test('getMergeBase between HEAD and HEAD~1', async () => {
		const mergeBase = await repo.provider.refs.getMergeBase(repo.path, 'HEAD', 'HEAD~1');
		assert.ok(mergeBase, 'Should find merge base');
		// Merge base of HEAD and HEAD~1 should be HEAD~1
		const head1 = getHeadSha(repo.path).slice(0, 7);
		assert.notStrictEqual(mergeBase.slice(0, 7), head1, 'Merge base should not be HEAD itself');
	});

	test('hasBranchOrTag returns true when branches exist', async () => {
		const has = await repo.provider.refs.hasBranchOrTag(repo.path);
		assert.strictEqual(has, true);
	});

	test('getReference resolves a branch name', async () => {
		const ref = await repo.provider.refs.getReference(repo.path, 'main');
		assert.ok(ref, 'Should resolve main');
		assert.strictEqual(ref.name, 'main');
		assert.strictEqual(ref.refType, 'branch');
	});
});
