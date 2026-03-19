import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { addCommit, createTag, createTestRepo, getHeadSha } from './helpers.js';

suite('TagsSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		createTag(repo.path, 'v1.0.0', 'First release');
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
		createTag(repo.path, 'v1.1.0');
		addCommit(repo.path, 'file2.txt', 'content', 'Third commit');
		createTag(repo.path, 'v2.0.0', 'Major release');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getTags returns all tags', async () => {
		const result = await repo.provider.tags.getTags(repo.path);
		assert.ok(result.values.length >= 3, `Expected at least 3 tags, got ${result.values.length}`);

		const names = result.values.map(t => t.name);
		assert.ok(names.includes('v1.0.0'), 'Should include v1.0.0');
		assert.ok(names.includes('v1.1.0'), 'Should include v1.1.0');
		assert.ok(names.includes('v2.0.0'), 'Should include v2.0.0');
	});

	test('getTags have sha references', async () => {
		const result = await repo.provider.tags.getTags(repo.path);
		for (const tag of result.values) {
			assert.ok(tag.sha, `Tag ${tag.name} should have a sha`);
			assert.ok(tag.sha.length >= 7, `Tag ${tag.name} sha should be at least 7 chars`);
		}
	});

	test('getTag returns a specific tag', async () => {
		const tag = await repo.provider.tags.getTag(repo.path, 'v2.0.0');
		assert.ok(tag, 'Should find v2.0.0');
		assert.strictEqual(tag.name, 'v2.0.0');
		assert.strictEqual(tag.sha, getHeadSha(repo.path));
	});

	test('getTags supports filtering', async () => {
		const result = await repo.provider.tags.getTags(repo.path, {
			filter: t => t.name.startsWith('v1.'),
		});
		assert.strictEqual(result.values.length, 2);
		for (const t of result.values) {
			assert.ok(t.name.startsWith('v1.'), `Tag ${t.name} should start with v1.`);
		}
	});
});
