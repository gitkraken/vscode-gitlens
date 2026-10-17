import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { MergeTargetsChangeEvent } from '@gitlens/git/cache.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import type { AnnouncedRepositoryChanges } from '@gitlens/git/providers/provider.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

/**
 * `onDidChangeMergeTargets` through the CLI provider's real gk config reconcile: what a watcher-reported
 * `.git/gk/config` change turns into, for external writes and for core's own.
 */
suite('CliGitProvider onDidChangeMergeTargets', () => {
	let repo: TestRepo;
	let events: MergeTargetsChangeEvent[];
	let hostChanges: { repoPath: string; changes: RepositoryChange[] }[];
	let announcements: AnnouncedRepositoryChanges[];

	function gkConfig(...args: string[]): void {
		execFileSync('git', ['config', '-f', join(repo.path, '.git', 'gk', 'config'), ...args], {
			cwd: repo.path,
			stdio: 'pipe',
		});
	}

	/** Reports the file change the way the watcher would, then waits out the async reconcile */
	async function reportGkConfigChange(): Promise<void> {
		repo.provider.cache.onRepositoryChanged(normalizePath(repo.path), ['gkConfig']);
		await new Promise(resolve => setTimeout(resolve, 300));
	}

	setup(async () => {
		hostChanges = [];
		announcements = [];
		repo = createTestRepo({
			hooks: {
				repository: {
					onChanged: (repoPath, changes) => hostChanges.push({ repoPath: repoPath, changes: changes }),
				},
			},
		});
		events = [];
		repo.provider.onDidChangeMergeTargets(e => events.push(e));
		repo.provider.onDidAnnounceChanges(e => announcements.push(e));

		// A first write creates `.git/gk/config`; a first read seeds the reconcile's baseline
		await repo.provider.config.setGkConfig(repo.path, 'branch.main.gk-merge-target', 'origin/main');
		await repo.provider.config.getGkConfig(repo.path, 'branch.main.gk-merge-target');
		await reportGkConfigChange();
		events.length = 0;
		hostChanges.length = 0;
		announcements.length = 0;
	});

	teardown(() => {
		sinon.restore();
		repo.cleanup();
	});

	test('stays silent for an external rewrite of activity timestamps only', async () => {
		gkConfig('branch.main.gk-last-accessed', '2026-10-05T00:00:00.000Z');
		await reportGkConfigChange();

		assert.deepStrictEqual(events, []);
	});

	test('names the branch when an external write changes its merge target', async () => {
		gkConfig('branch.main.gk-merge-target-user', 'develop');
		await reportGkConfigChange();

		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].repoPath, normalizePath(repo.path));
		assert.deepStrictEqual([...(events[0].refs ?? [])], ['main']);
	});

	test('re-announces a reconciled external change to the host alone, keeping the map it reconciled', async () => {
		const run = sinon.spy(repo.provider.git, 'run');
		gkConfig('branch.main.gk-merge-target-user', 'develop');
		await reportGkConfigChange();

		assert.strictEqual(events.length, 1, 'the change was reconciled');
		assert.deepStrictEqual(
			hostChanges.map(c => [normalizePath(c.repoPath), c.changes]),
			[[normalizePath(repo.path), ['gkConfig']]],
		);
		assert.deepStrictEqual(announcements, [], 'the follow-up is not a write of core');

		const gkConfigReads = (): number =>
			run.getCalls().filter(c => c.args.includes('--get-regex') && c.args.includes('-f')).length;
		assert.strictEqual(gkConfigReads(), 1, 'only the reconcile read the gk config');
		assert.strictEqual(
			await repo.provider.config.getGkConfig(repo.path, 'branch.main.gk-merge-target-user'),
			'develop',
		);
		assert.strictEqual(gkConfigReads(), 1, 'the reconciled map still serves reads');
	});

	test("stays silent for core's own merge-target write", async () => {
		await repo.provider.config.setGkConfig(repo.path, 'branch.main.gk-merge-target', 'origin/develop');
		await reportGkConfigChange();

		assert.deepStrictEqual(events, []);
	});

	test("stays silent for core's own section remove and rename", async () => {
		await repo.provider.config.setGkConfig(repo.path, 'branch.topic.gk-merge-base', 'main');
		await reportGkConfigChange();
		events.length = 0;

		await repo.provider.config.renameGkConfigBranchSection?.(repo.path, 'topic', 'renamed');
		await reportGkConfigChange();
		await repo.provider.config.removeGkConfigBranchSection?.(repo.path, 'renamed');
		await reportGkConfigChange();

		assert.deepStrictEqual(events, []);
	});
});
