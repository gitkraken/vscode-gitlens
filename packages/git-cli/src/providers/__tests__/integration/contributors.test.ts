import * as assert from 'assert';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestRepo } from './helpers.js';
import { addCommit, createTestRepo } from './helpers.js';

suite('ContributorsSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'file1.txt', 'content1', 'Commit by test user');

		// Add a commit by a different author
		writeFileSync(join(repo.path, 'file2.txt'), 'content2');
		execSync(
			'git add file2.txt && git -c user.name="Other Dev" -c user.email="other@dev.test" commit -m "Commit by other"',
			{ cwd: repo.path, stdio: 'pipe' },
		);
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getContributors returns all contributors', async () => {
		const result = await repo.provider.contributors.getContributors(repo.path);
		assert.ok(
			result.contributors.length >= 2,
			`Expected at least 2 contributors, got ${result.contributors.length}`,
		);

		const names = result.contributors.map(c => c.name);
		assert.ok(names.includes('Test User'), 'Should include Test User');
		assert.ok(names.includes('Other Dev'), 'Should include Other Dev');
	});

	test('contributors have email addresses', async () => {
		const result = await repo.provider.contributors.getContributors(repo.path);
		const testUser = result.contributors.find(c => c.name === 'Test User');
		assert.ok(testUser, 'Should find Test User');
		assert.strictEqual(testUser.email, 'test@gitlens.test');

		const otherDev = result.contributors.find(c => c.name === 'Other Dev');
		assert.ok(otherDev, 'Should find Other Dev');
		assert.strictEqual(otherDev.email, 'other@dev.test');
	});
});
