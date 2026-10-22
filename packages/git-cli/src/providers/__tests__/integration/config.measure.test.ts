import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { MergeTargetsChangeEvent } from '@gitlens/git/cache.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { gkConfigFingerprintClock } from '../../config.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo, createWorktree } from './helpers.js';

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

	test('a cold read of a migrated repository never enters the migration, which logs every call', async () => {
		const config = repo.provider.config;
		// The first lookup in this process runs the migration's check, which is what marks the repository migrated
		await config.getGkConfig(repo.path, 'branch.main.gk-merge-base');
		const migrate = sinon.spy(
			config as unknown as { migrateGkConfigFromGitConfig: (repoPath: string) => Promise<void> },
			'migrateGkConfigFromGitConfig',
		);
		try {
			repo.provider.cache.deleteGkConfigMap(repo.path);
			assert.strictEqual(await config.getGkConfig(repo.path, 'branch.main.gk-merge-base'), 'main');
			assert.strictEqual(migrate.callCount, 0);
		} finally {
			migrate.restore();
		}
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

/**
 * `.git/gk/config` lives in the common dir, so the watcher reports one `'gkConfig'` per checkout sharing it, and
 * one more burst for each of core's own writes (a branch-activity stamp writes two keys). The reconcile still diffs
 * every report against its baseline, but a report of a file that hasn't changed since the cached map was read must
 * not re-read it.
 */
suite('ConfigSubProvider (gk config watcher echo)', () => {
	let repo: TestRepo;
	let worktrees: { path: string; cleanup: () => void }[];
	let paths: string[];
	let events: MergeTargetsChangeEvent[];
	let clock: sinon.SinonStub<[], number>;
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

	const bulkReadsSince = (mark: number) => completed.slice(mark).filter(m => m.includes(' --get-regex ')).length;

	function writeExternally(key: string, value: string): void {
		execFileSync('git', ['config', '-f', join(repo.path, '.git', 'gk', 'config'), key, value], {
			cwd: repo.path,
			stdio: 'pipe',
		});
	}

	/** Reports the file change from every checkout, the way the watcher would, then waits out the async reconcile */
	async function reportGkConfigChange(): Promise<void> {
		for (const path of paths) {
			repo.provider.cache.onRepositoryChanged(path, ['gkConfig']);
		}
		await new Promise(resolve => setTimeout(resolve, 300));
	}

	async function readFromEveryCheckout(key: Parameters<typeof repo.provider.config.getGkConfig>[1]) {
		return Promise.all(paths.map(path => repo.provider.config.getGkConfig(path, key)));
	}

	setup(async () => {
		repo = createTestRepo({ gitOptions: { logger: countingLogger } });
		createBranch(repo.path, 'feature/a');
		createBranch(repo.path, 'feature/b');
		worktrees = [createWorktree(repo.path, 'feature/a'), createWorktree(repo.path, 'feature/b')];
		paths = [repo.path, ...worktrees.map(w => w.path)].map(p => normalizePath(p));
		for (const path of paths) {
			repo.provider.cache.registerRepoPath(fileUri(path), await repo.provider.config.getGitDir(path));
		}

		// Pre-seeded, so the one-time migration short-circuits
		mkdirSync(join(repo.path, '.git', 'gk'), { recursive: true });
		writeExternally('branch.main.gk-merge-target', 'origin/main');
		writeExternally('branch.feature/a.gk-merge-base', 'main');

		events = [];
		repo.provider.onDidChangeMergeTargets(e => events.push(e));

		// Every read's stat counts as taken long after the file's last change, so the counts below don't hinge on how
		// soon after a write the test reads; a stat taken too soon has its own test
		clock = sinon.stub(gkConfigFingerprintClock, 'now').callsFake(() => Date.now() + 60_000);

		// Prime the map and the reconcile's baseline
		await readFromEveryCheckout('branch.main.gk-merge-target');
	});

	teardown(() => {
		sinon.restore();
		for (const worktree of worktrees) {
			worktree.cleanup();
		}
		repo.cleanup();
	});

	test("the echo of core's own stamp, reported by every checkout, re-reads the gk config once (was 4)", async () => {
		await repo.provider.branches.onCurrentBranchModified(repo.path);

		const mark = completed.length;
		// One report per checkout for each of the stamp's two writes
		await reportGkConfigChange();
		const [stamp] = await readFromEveryCheckout('branch.main.gk-last-modified');
		await reportGkConfigChange();
		const stamps = await readFromEveryCheckout('branch.main.gk-last-modified');

		const reads = bulkReadsSince(mark);
		console.error(`[measure] stamp echo across ${paths.length} checkouts → ${reads} bulk gk read(s)`);
		assert.ok(stamp, 'the stamp was written');
		assert.deepStrictEqual(stamps, [stamp, stamp, stamp]);
		assert.strictEqual(reads, 1, 'only the first read after the write may hit the file');
		assert.deepStrictEqual(events, [], 'an activity stamp changes no merge target');
	});

	test('an external merge-target write reported by every checkout is read once and cascades (was 2 reads)', async () => {
		writeExternally('branch.main.gk-merge-target-user', 'develop');

		const mark = completed.length;
		await reportGkConfigChange();

		assert.deepStrictEqual(
			events.map(e => [e.repoPath, [...(e.refs ?? [])]]),
			[[paths[0], ['main']]],
		);
		assert.deepStrictEqual(await readFromEveryCheckout('branch.main.gk-merge-target-user'), [
			'develop',
			'develop',
			'develop',
		]);
		assert.strictEqual(bulkReadsSince(mark), 1, 'the change is read once, not once per checkout');
	});

	test('a read landing between an external write and its report is diffed without a re-read (was 2)', async () => {
		// Core's own write drops the cached map, so the next read sees whatever is on disk by then
		await repo.provider.config.setGkConfig(repo.path, 'branch.main.gk-last-accessed', '2026-10-05T00:00:00.000Z');
		writeExternally('branch.main.gk-merge-target-user', 'develop');
		assert.strictEqual(
			await repo.provider.config.getGkConfig(paths[1], 'branch.main.gk-merge-target-user'),
			'develop',
		);

		const mark = completed.length;
		await reportGkConfigChange();

		assert.deepStrictEqual(
			events.map(e => [e.repoPath, [...(e.refs ?? [])]]),
			[[paths[0], ['main']]],
			'the external change is announced although the cached map already holds it',
		);
		assert.strictEqual(bulkReadsSince(mark), 0, 'the map read after the external write still reflects the file');
	});

	test('a report while a read from before the write is still in flight re-reads rather than joining it', async () => {
		const git = repo.provider.git;
		const run = git.run.bind(git);
		let release!: () => void;
		const released = new Promise<void>(resolve => (release = resolve));
		let held!: () => void;
		const isHeld = new Promise<void>(resolve => (held = resolve));
		let holding = true;
		// Holds the first bulk read's result after it read the file, so it can only answer the pre-write content
		const runStub = sinon.stub(git, 'run').callsFake(async (...args: Parameters<typeof git.run>) => {
			const result = await run(...args);
			if (holding && args.includes('--get-regex')) {
				holding = false;
				held();
				await released;
			}
			return result;
		});
		try {
			repo.provider.cache.deleteGkConfigMap(repo.path);
			const stale = repo.provider.config.getGkConfig(repo.path, 'branch.main.gk-merge-target-user');
			await isHeld;

			writeExternally('branch.main.gk-merge-target-user', 'develop');
			for (const path of paths) {
				repo.provider.cache.onRepositoryChanged(path, ['gkConfig']);
			}
			release();

			assert.strictEqual(await stale, undefined, 'the held read answers what it read');
			await new Promise(resolve => setTimeout(resolve, 300));
			assert.deepStrictEqual(
				events.map(e => [e.repoPath, [...(e.refs ?? [])]]),
				[[paths[0], ['main']]],
			);
			assert.deepStrictEqual(await readFromEveryCheckout('branch.main.gk-merge-target-user'), [
				'develop',
				'develop',
				'develop',
			]);
		} finally {
			runStub.restore();
		}
	});

	test("a read whose stat came right after the file's change doesn't keep the map", async () => {
		const gkConfigPath = join(repo.path, '.git', 'gk', 'config');
		writeExternally('branch.main.gk-merge-target-user', 'develop');
		const stat = statSync(gkConfigPath, { bigint: true });
		const changedMs = Number((stat.mtimeNs > stat.ctimeNs ? stat.mtimeNs : stat.ctimeNs) / 1_000_000n);

		// Only the next read's stat lands in the tick of the change; a later write in that tick could match it
		clock.onCall(clock.callCount).returns(changedMs);
		repo.provider.cache.deleteGkConfigMap(repo.path);
		assert.strictEqual(
			await repo.provider.config.getGkConfig(paths[1], 'branch.main.gk-merge-target-user'),
			'develop',
		);

		const mark = completed.length;
		await reportGkConfigChange();

		assert.strictEqual(bulkReadsSince(mark), 1, 'the report re-reads the file once, as for a changed file');
		assert.deepStrictEqual(
			events.map(e => [e.repoPath, [...(e.refs ?? [])]]),
			[[paths[0], ['main']]],
		);
	});

	test('a kept read that fails is read once afresh rather than falling back to the coarse clear', async () => {
		const git = repo.provider.git;
		const run = git.run.bind(git);
		let release!: () => void;
		const released = new Promise<void>(resolve => (release = resolve));
		let held!: () => void;
		const isHeld = new Promise<void>(resolve => (held = resolve));
		let failing = true;
		// Holds the first bulk read, then fails it the way a lock or I/O error would
		const runStub = sinon.stub(git, 'run').callsFake(async (...args: Parameters<typeof git.run>) => {
			const result = await run(...args);
			if (failing && args.includes('--get-regex')) {
				failing = false;
				held();
				await released;
				return { ...result, stdout: '', exitCode: 128, completion: { status: 'exited', code: 128 } };
			}
			return result;
		});
		try {
			repo.provider.cache.deleteGkConfigMap(repo.path);
			const mark = completed.length;
			const failed = repo.provider.config.getGkConfig(repo.path, 'branch.main.gk-merge-target');
			await isHeld;

			// The file is unchanged since the held read stat'd it, so every report keeps that read
			for (const path of paths) {
				repo.provider.cache.onRepositoryChanged(path, ['gkConfig']);
			}
			release();

			assert.strictEqual(await failed, undefined, 'the held read failed');
			await new Promise(resolve => setTimeout(resolve, 300));
			assert.deepStrictEqual(events, [], 'the coarse fallback reports every branch as changed');
			assert.strictEqual(bulkReadsSince(mark), 2, 'the failed read, then the reconcile reading afresh');
			assert.deepStrictEqual(await readFromEveryCheckout('branch.main.gk-merge-target'), [
				'origin/main',
				'origin/main',
				'origin/main',
			]);
		} finally {
			runStub.restore();
		}
	});
});
