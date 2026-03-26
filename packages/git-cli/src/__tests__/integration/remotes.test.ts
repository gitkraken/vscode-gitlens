import * as assert from 'assert';
import { execSync } from 'node:child_process';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

suite('RemotesSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		// Add a couple of remotes
		execSync('git remote add origin https://github.com/test/repo.git', { cwd: repo.path, stdio: 'pipe' });
		execSync('git remote add upstream git@github.com:upstream/repo.git', { cwd: repo.path, stdio: 'pipe' });
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getRemotes returns all remotes', async () => {
		const remotes = await repo.provider.remotes.getRemotes(repo.path);
		assert.strictEqual(remotes.length, 2);

		const names = remotes.map(r => r.name);
		assert.ok(names.includes('origin'), 'Should include origin');
		assert.ok(names.includes('upstream'), 'Should include upstream');
	});

	test('remotes have correct URLs', async () => {
		const remotes = await repo.provider.remotes.getRemotes(repo.path);

		const origin = remotes.find(r => r.name === 'origin');
		assert.ok(origin, 'Should find origin');
		assert.ok(origin.urls.length > 0, 'Origin should have URLs');
		assert.ok(
			origin.urls.some(u => {
				try {
					const parsed = new URL(u.url);
					return parsed.hostname === 'github.com' && parsed.pathname.includes('/test/repo');
				} catch {
					// Fallback for non-standard Git URLs (e.g. SSH-style).
					return u.url.includes('github.com/test/repo');
				}
			}),
			'Origin URL should contain github.com/test/repo',
		);

		const upstream = remotes.find(r => r.name === 'upstream');
		assert.ok(upstream, 'Should find upstream');
		assert.ok(
			upstream.urls.some(u => {
				try {
					const parsed = new URL(u.url);
					return parsed.hostname === 'github.com';
				} catch {
					// Fallback for non-standard Git URLs (e.g. SSH-style).
					return u.url.includes('github.com');
				}
			}),
			'Upstream URL should contain github.com',
		);
	});

	test('getRemotes returns empty for repo without remotes', async () => {
		// Use a separate repo to avoid cache issues
		const { path: emptyPath, provider: emptyProvider, cleanup } = (await import('./helpers.js')).createTestRepo();
		try {
			const remotes = await emptyProvider.remotes.getRemotes(emptyPath);
			assert.strictEqual(remotes.length, 0);
		} finally {
			cleanup();
		}
	});
});
