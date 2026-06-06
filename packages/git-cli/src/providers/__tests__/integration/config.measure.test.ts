import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LogChannel } from '@gitlens/utils/logger.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo } from './helpers.js';

/**
 * The whole `.git/gk/config` is read once (`git config --get-regexp .`) and every per-key
 * (getGkConfig) / per-namespace (getGkConfigRegex) lookup is served from that single cached map.
 *
 * Each finished git subprocess logs one `… • completed` line through `gitOptions.logger`, so a
 * counting channel gives an exact spawn count. Before this change a branch-overview render that
 * touched the four per-branch gk namespaces (merge-base / merge-target / merge-target-user /
 * associated-issues) spawned one `--get-regex` per namespace (4); now it spawns one bulk read (1).
 */
suite('ConfigSubProvider (bulk gk read)', () => {
	let repo: TestRepo;
	const completed: string[] = [];

	const countingLogger: LogChannel = {
		name: 'spawn-counter',
		logLevel: 0,
		dispose: () => {},
		trace: () => {},
		debug: () => {},
		info: (msg: string) => {
			if (msg.includes('• completed')) {
				completed.push(msg);
			}
		},
		warn: () => {},
		error: () => {},
	};

	const countSince = (mark: number, needle: string) =>
		completed.slice(mark).filter(m => m.includes(` ${needle} `)).length;

	const gkKeys = [
		'branch.main.gk-merge-base',
		'branch.main.gk-merge-target',
		'branch.main.gk-merge-target-user',
		'branch.main.gk-associated-issues',
	] as const;

	suiteSetup(() => {
		repo = createTestRepo({ gitOptions: { logger: countingLogger } });
		createBranch(repo.path, 'feature/a');

		// Pre-seed `.git/gk/config` so the one-time migration short-circuits (file already exists),
		// isolating the measurement from migration's own read.
		const gkConfig = join(repo.path, '.git', 'gk', 'config');
		mkdirSync(join(repo.path, '.git', 'gk'), { recursive: true });
		const seed: [string, string][] = [
			['branch.main.gk-merge-base', 'main'],
			['branch.main.gk-merge-target', 'origin/main'],
			['branch.feature/a.gk-merge-base', 'main'],
			['gk.defaultRemote', 'origin'],
		];
		for (const [key, value] of seed) {
			execFileSync('git', ['config', '-f', gkConfig, key, value], { cwd: repo.path, stdio: 'pipe' });
		}
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('a cold overview read across 4 gk namespaces spawns ONE bulk `git config` read', async () => {
		const config = repo.provider.config;

		// Cold cache (fresh provider, gk/config pre-exists). Reading four distinct namespaces used
		// to spawn four `--get-regex`; it must now spawn a single bulk `--get-regexp`.
		const mark = completed.length;
		for (const key of gkKeys) {
			await config.getGkConfig(repo.path, key);
		}
		const configSpawns = countSince(mark, 'config');

		console.error(`[measure] cold gk overview read → ${configSpawns} \`git config\` spawn(s) (was 4)`);
		assert.strictEqual(configSpawns, 1, 'expected one bulk gk read, not one per namespace');
	});

	test('warm re-reads are served from the cached map (zero spawns)', async () => {
		const config = repo.provider.config;

		const mark = completed.length;
		for (const key of gkKeys) {
			await config.getGkConfig(repo.path, key);
		}
		assert.strictEqual(countSince(mark, 'config'), 0, 'warm reads must be served from cache');
	});

	test('per-key and per-namespace lookups return correct values from the bulk map', async () => {
		const config = repo.provider.config;

		assert.strictEqual(await config.getGkConfig(repo.path, 'branch.main.gk-merge-base'), 'main');
		assert.strictEqual(await config.getGkConfig(repo.path, 'branch.main.gk-merge-target'), 'origin/main');
		assert.strictEqual(
			await config.getGkConfig(repo.path, 'branch.main.gk-merge-target-user'),
			undefined,
			'unset key resolves to undefined',
		);
		// Subsection-less key: git lowercases it to `gk.defaultremote` in `--get-regexp` output, so the
		// camelCase lookup must canonicalize to match (regression guard for a silently-lost default remote).
		assert.strictEqual(await config.getGkConfig(repo.path, 'gk.defaultRemote'), 'origin');

		// getGkConfigRegex must filter the bulk map to just the matching namespace across branches.
		const mergeBases = await config.getGkConfigRegex(repo.path, '^branch\\..+\\.gk-merge-base$');
		assert.deepStrictEqual(
			[...mergeBases].sort(),
			[
				['branch.feature/a.gk-merge-base', 'main'],
				['branch.main.gk-merge-base', 'main'],
			],
			'regex lookup returns exactly the merge-base namespace',
		);
	});

	test('a gk write invalidates the bulk map: next read sees the new value with one re-read', async () => {
		const config = repo.provider.config;

		// Populate the cache.
		await config.getGkConfig(repo.path, 'branch.main.gk-merge-target-user');

		await config.setGkConfig(repo.path, 'branch.main.gk-merge-target-user', 'origin/develop');

		const mark = completed.length;
		const value = await config.getGkConfig(repo.path, 'branch.main.gk-merge-target-user');
		assert.strictEqual(value, 'origin/develop', 'read reflects the write');
		assert.strictEqual(countSince(mark, 'config'), 1, 'one bulk re-read after the write invalidates the map');
	});
});
