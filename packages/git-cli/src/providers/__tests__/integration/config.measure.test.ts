import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/**
 * Conditional includes and config.worktree can change the effective inputs even for registered sibling checkouts. With
 * `extensions.worktreeConfig` set, every checkout reads its own listing.
 */
suite('BranchesSubProvider.getAheadOfBaseConfigKey (cached per checkout)', () => {
	let repo: TestRepo;
	let worktrees: { path: string; cleanup: () => void }[];
	let paths: string[];
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

	const configKeyReadsSince = (mark: number) =>
		completed.slice(mark).filter(m => m.includes(' --null --get-regexp ')).length;

	function writeExternally(key: string, value: string): void {
		execFileSync('git', ['config', key, value], { cwd: repo.path, stdio: 'pipe' });
	}

	async function readFromEveryCheckout(): Promise<(string | undefined)[]> {
		return Promise.all(paths.map(path => repo.provider.branches.getAheadOfBaseConfigKey(path)));
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
		writeExternally('remote.origin.url', 'https://example.com/repo.git');
		writeExternally('extensions.worktreeConfig', 'true');
	});

	teardown(() => {
		sinon.restore();
		for (const worktree of worktrees) {
			worktree.cleanup();
		}
		repo.cleanup();
	});

	test('cold checkouts each spawn once, and repeated reads stay warm', async () => {
		const mark = completed.length;
		const keys = await readFromEveryCheckout();

		assert.strictEqual(configKeyReadsSince(mark), paths.length);
		assert.ok(keys[0]?.includes('remote.origin.url'), 'the snapshot holds the remotes');
		assert.deepStrictEqual(
			keys,
			[keys[0], keys[0], keys[0]],
			'checkouts with equal effective config have equal snapshots',
		);
		await readFromEveryCheckout();
		assert.strictEqual(configKeyReadsSince(mark), paths.length, 'warm checkouts spawn nothing');
	});

	test("an external write invalidates each checkout's effective snapshot", async () => {
		await readFromEveryCheckout();
		writeExternally('branch.feature/a.merge', 'refs/heads/main');
		for (const path of paths) {
			repo.provider.cache.onRepositoryChanged(path, ['config']);
		}

		const mark = completed.length;
		const keys = await readFromEveryCheckout();

		assert.strictEqual(configKeyReadsSince(mark), paths.length);
		for (const key of keys) {
			assert.ok(key?.includes('branch.feature/a.merge'), 'every checkout sees the write');
		}
	});

	test("core's own write invalidates every checkout's effective snapshot", async () => {
		await readFromEveryCheckout();
		await repo.provider.config.setConfig(paths[1], 'branch.feature/a.remote', 'origin');

		const mark = completed.length;
		const keys = await readFromEveryCheckout();

		assert.strictEqual(configKeyReadsSince(mark), paths.length);
		for (const key of keys) {
			assert.ok(key?.includes('branch.feature/a.remote'), 'every checkout sees the write');
		}
	});

	test('a report while a read from before the write is still in flight re-reads rather than joining it', async () => {
		const git = repo.provider.git;
		const run = git.run.bind(git);
		let release!: () => void;
		const released = new Promise<void>(resolve => (release = resolve));
		let held!: () => void;
		const isHeld = new Promise<void>(resolve => (held = resolve));
		let holding = true;
		// Holds the first read's result after it read the config, so it can only answer the pre-write content
		sinon.stub(git, 'run').callsFake(async (...args: Parameters<typeof git.run>) => {
			const result = await run(...args);
			if (holding && args.includes('--get-regexp')) {
				holding = false;
				held();
				await released;
			}
			return result;
		});

		const mark = completed.length;
		const stale = repo.provider.branches.getAheadOfBaseConfigKey(paths[0]);
		await isHeld;

		writeExternally('branch.feature/b.merge', 'refs/heads/main');
		repo.provider.cache.onRepositoryChanged(paths[2], ['config']);
		const fresh = repo.provider.branches.getAheadOfBaseConfigKey(paths[2]);
		release();

		assert.ok(!(await stale)?.includes('branch.feature/b.merge'), 'the held read answers what it read');
		assert.ok((await fresh)?.includes('branch.feature/b.merge'), 'the read after the report sees the write');
		// The linked checkout's first read lists the main checkout's config to learn that config differs by checkout
		assert.strictEqual(configKeyReadsSince(mark), 3);
	});
});

/**
 * Without config that can differ by checkout (`extensions.worktreeConfig`, or a conditional include that can tell
 * checkouts apart), every checkout of a repository shares one listing, read in the main checkout.
 */
suite('BranchesSubProvider.getAheadOfBaseConfigKey (shared by every checkout)', () => {
	let scratch: string;
	let globalConfig: string;
	let previousGlobalConfig: string | undefined;
	let repo: TestRepo;
	let worktrees: { path: string; cleanup: () => void }[];
	let paths: string[];
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

	const listingsSince = (mark: number) => completed.slice(mark).filter(m => m.includes(' --null --get-regexp '));

	function git(cwd: string, ...args: string[]): string {
		return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
	}

	/** A `.git/config` change, reported as the watcher would */
	function reportConfigChange(): void {
		for (const path of paths) {
			repo.provider.cache.onRepositoryChanged(path, ['config']);
		}
	}

	async function readFromEveryCheckout(): Promise<(string | undefined)[]> {
		return Promise.all(paths.map(path => repo.provider.branches.getAheadOfBaseConfigKey(path)));
	}

	suiteSetup(() => {
		// The machine's own global config could hold a conditional include that tells checkouts apart
		scratch = mkdtempSync(join(tmpdir(), 'gitlens-config-key-'));
		globalConfig = join(scratch, 'gitconfig');
		previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = globalConfig;
	});

	suiteTeardown(() => {
		if (previousGlobalConfig == null) {
			delete process.env.GIT_CONFIG_GLOBAL;
		} else {
			process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
		}
		rmSync(scratch, { recursive: true, force: true });
	});

	setup(async () => {
		writeFileSync(globalConfig, '');
		repo = createTestRepo({ gitOptions: { logger: countingLogger } });
		createBranch(repo.path, 'feature/a');
		createBranch(repo.path, 'feature/b');
		worktrees = [createWorktree(repo.path, 'feature/a'), createWorktree(repo.path, 'feature/b')];
		paths = [repo.path, ...worktrees.map(w => w.path)].map(p => normalizePath(p));
		for (const path of paths) {
			repo.provider.cache.registerRepoPath(fileUri(path), await repo.provider.config.getGitDir(path));
		}
		git(repo.path, 'config', 'remote.origin.url', 'https://example.com/repo.git');
	});

	teardown(() => {
		for (const worktree of worktrees) {
			worktree.cleanup();
		}
		repo.cleanup();
	});

	test('cold checkouts share one listing in the main checkout, and repeated reads stay warm', async () => {
		const mark = completed.length;
		const keys = await readFromEveryCheckout();

		const listings = listingsSince(mark);
		assert.strictEqual(listings.length, 1, listings.join('\n'));
		assert.ok(listings[0].includes(`[${paths[0]}]`), listings[0]);
		assert.ok(keys[0]?.includes('remote.origin.url'), 'the snapshot holds the remotes');
		assert.deepStrictEqual(keys, [keys[0], keys[0], keys[0]]);
		await readFromEveryCheckout();
		assert.strictEqual(listingsSince(mark).length, 1, 'warm checkouts spawn nothing');
	});

	test('an external write is listed once for every checkout', async () => {
		await readFromEveryCheckout();
		git(repo.path, 'config', 'branch.feature/a.merge', 'refs/heads/main');
		reportConfigChange();

		const mark = completed.length;
		const keys = await readFromEveryCheckout();

		assert.strictEqual(listingsSince(mark).length, 1);
		for (const key of keys) {
			assert.ok(key?.includes('branch.feature/a.merge'), 'every checkout sees the write');
		}
	});

	test('a repository whose config comes to differ by checkout lists each checkout, until it no longer does', async () => {
		await readFromEveryCheckout();
		git(repo.path, 'config', 'extensions.worktreeConfig', 'true');
		git(paths[1], 'config', '--worktree', 'branch.main.remote', 'linked-origin');
		reportConfigChange();

		let mark = completed.length;
		let keys = await readFromEveryCheckout();
		assert.ok(keys[1]?.includes('linked-origin'), 'the linked checkout reads its own config.worktree');
		assert.ok(!keys[0]?.includes('linked-origin'));
		assert.ok(!keys[2]?.includes('linked-origin'));
		// The main checkout's listing, which shows config differs by checkout, then each linked checkout's own
		assert.strictEqual(listingsSince(mark).length, 3);

		git(repo.path, 'config', 'remote.origin.pushurl', 'https://example.com/push.git');
		reportConfigChange();
		mark = completed.length;
		keys = await readFromEveryCheckout();
		assert.ok(keys[1]?.includes('linked-origin'));
		assert.strictEqual(listingsSince(mark).length, paths.length, 'once known, one listing per checkout');

		git(paths[1], 'config', '--worktree', '--unset', 'branch.main.remote');
		git(repo.path, 'config', '--unset', 'extensions.worktreeConfig');
		reportConfigChange();
		mark = completed.length;
		keys = await readFromEveryCheckout();
		assert.deepStrictEqual(keys, [keys[0], keys[0], keys[0]]);
		assert.strictEqual(listingsSince(mark).length, paths.length, 'each linked checkout finds it shares again');

		reportConfigChange();
		mark = completed.length;
		await readFromEveryCheckout();
		assert.strictEqual(listingsSince(mark).length, 1, 'then they share one listing again');
	});

	test('a gitdir include only linked checkouts match still shares one listing', async () => {
		// Accepted gap: a gitdir include only linked checkouts match is the common identity setup, so it stays shared;
		// an edit to the file it includes goes unseen in those checkouts until a change the shared listing sees
		const commonGitDir = realpathSync(join(repo.path, '.git'));
		const include = join(scratch, 'include');
		writeFileSync(include, '[branch "main"]\n\tremote = included-origin\n');
		writeFileSync(globalConfig, `[includeIf "gitdir:${commonGitDir}/worktrees/"]\n\tpath = ${include}\n`);
		assert.strictEqual(git(paths[1], 'config', 'branch.main.remote'), 'included-origin', 'git applies it there');
		assert.throws(() => git(paths[0], 'config', 'branch.main.remote'), 'and not in the main checkout');

		let mark = completed.length;
		const keys = await readFromEveryCheckout();
		assert.strictEqual(listingsSince(mark).length, 1);
		assert.deepStrictEqual(keys, [keys[0], keys[0], keys[0]], "every checkout keys on the main checkout's listing");
		assert.ok(!keys[0]?.includes('included-origin'));

		git(repo.path, 'config', 'branch.feature/a.merge', 'refs/heads/main');
		reportConfigChange();
		mark = completed.length;
		const after = await readFromEveryCheckout();
		assert.strictEqual(listingsSince(mark).length, 1);
		for (const [i, key] of after.entries()) {
			assert.notStrictEqual(key, keys[i], "a watched write still changes every checkout's key");
		}
	});
});
