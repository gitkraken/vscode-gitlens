import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

suite('ConfigSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getConfig reads user.name', async () => {
		const value = await repo.provider.config.getConfig(repo.path, 'user.name');
		assert.strictEqual(value, 'Test User');
	});

	test('getConfig reads user.email', async () => {
		const value = await repo.provider.config.getConfig(repo.path, 'user.email');
		assert.strictEqual(value, 'test@gitlens.test');
	});

	test('getConfig returns undefined for unset keys', async () => {
		const value = await repo.provider.config.getConfig(repo.path, 'gitlens.nonexistent.key' as any);
		assert.strictEqual(value, undefined);
	});
});
