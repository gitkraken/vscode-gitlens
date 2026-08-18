import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitMaintenanceTask } from '@gitlens/git/providers/maintenance.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	addEmptyCommits,
	addWorktree,
	commitGraphChainDir,
	createTestRepo,
	gkConfig,
	maintenanceOf,
	setConfig,
} from './helpers.js';

function objectCount(repoPath: string): { objects: number; packs: number } {
	const values = new Map<string, number>();
	const stdout = execFileSync('git', ['count-objects', '-v'], { cwd: repoPath, encoding: 'utf8' });
	for (const line of stdout.split('\n')) {
		const [key, raw] = line.split(':', 2);
		if (key != null && raw != null) {
			values.set(key, Number(raw.trim()));
		}
	}
	return { objects: (values.get('count') ?? 0) + (values.get('in-pack') ?? 0), packs: values.get('packs') ?? 0 };
}

/**
 * Await the private demand-cadence write (`ensureCommitGraph` returns its fire-and-forget promise purely for
 * tests) — the seam behind `request('commit-graph')`, moved from the graph sub-provider to maintenance.
 */
function ensureCommitGraph(repo: TestRepo, repoPath: string): Promise<boolean> {
	// oxlint-disable-next-line no-explicit-any -- deliberate reach into the private test seam
	return (repo.provider.maintenance as any).ensureCommitGraph(repoPath) as Promise<boolean>;
}

/**
 * Black-box read of the NEWEST commit-graph layer's chunk ids — mirrors the production resolution logic
 * (the chain's last-listed layer when split, else the single file) via plain filesystem reads, not the
 * private probe method: chunk table layout is `CGPH` magic + version + hash-version + chunk count (byte 6)
 * + base-graph count, then `(chunkCount + 1)` entries of 4-byte id + 8-byte big-endian offset.
 */
async function readNewestCommitGraphChunkIds(repoPath: string): Promise<string[]> {
	const infoDir = join(repoPath, '.git', 'objects', 'info');
	const chainPath = join(infoDir, 'commit-graphs', 'commit-graph-chain');

	let graphPath = join(infoDir, 'commit-graph');
	if (existsSync(chainPath)) {
		const hashes = readFileSync(chainPath, 'utf8')
			.split('\n')
			.map(line => line.trim())
			.filter(line => line !== '');
		if (hashes.length) {
			graphPath = join(infoDir, 'commit-graphs', `graph-${hashes.at(-1)!}.graph`);
		}
	}

	const handle = await open(graphPath, 'r');
	try {
		const header = Buffer.alloc(8);
		await handle.read(header, 0, 8, 0);
		const chunkCount = header.readUInt8(6);

		const table = Buffer.alloc((chunkCount + 1) * 12);
		await handle.read(table, 0, table.length, 8);

		const ids: string[] = [];
		for (let i = 0; i <= chunkCount; i++) {
			ids.push(table.toString('ascii', i * 12, i * 12 + 4));
		}
		return ids;
	} finally {
		await handle.close();
	}
}

// The demand-cadence commit-graph write defaults ON for every graph user (the harness's minimal context
// disables it, so these tests opt back in per-repo via the config override).
suite('maintenance commit-graph demand cadence (ensureCommitGraph)', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo({ config: { commits: {}, graph: { writeCommitGraph: true } } });
		addEmptyCommits(repo.path, 3, 'c');
	});

	teardown(() => {
		repo.cleanup();
	});

	test('writes the split commit-graph chain by default', async () => {
		await ensureCommitGraph(repo, repo.path);
		assert.strictEqual(
			existsSync(commitGraphChainDir(repo.path)),
			true,
			'expected a `--split` write to create the commit-graphs chain dir',
		);
	});

	// Git accepts every one of these as a falsy boolean — a raw string compare against only `false`
	// previously wrote the cache despite an explicit user opt-out (`--type=bool` normalizes them all).
	function addOptOutTest(value: string): void {
		test(`respects an explicit core.commitGraph=${value} read opt-out`, async () => {
			setConfig(repo.path, 'core.commitGraph', value);
			await ensureCommitGraph(repo, repo.path);
			assert.strictEqual(
				existsSync(commitGraphChainDir(repo.path)),
				false,
				`core.commitGraph=${value} must skip the write`,
			);
		});
	}
	for (const value of ['false', 'no', 'off', '0']) {
		addOptOutTest(value);
	}

	test('an unset core.commitGraph (the default) writes', async () => {
		// Explicitly NOT set — mirrors the overwhelmingly common user state.
		await ensureCommitGraph(repo, repo.path);
		assert.strictEqual(existsSync(commitGraphChainDir(repo.path)), true);
	});

	test('an explicit run respects core.commitGraph=false', async () => {
		setConfig(repo.path, 'core.commitGraph', 'false');
		const ran = await maintenanceOf(repo).runMaintenanceTask(repo.path, 'commit-graph');
		assert.strictEqual(ran, false);
		assert.strictEqual(existsSync(commitGraphChainDir(repo.path)), false);
	});

	test('an explicit run respects the per-repository commit-graph disable marker', async () => {
		await maintenanceOf(repo).setCommitGraphDisabled(repo.path, true);
		const ran = await maintenanceOf(repo).runMaintenanceTask(repo.path, 'commit-graph');
		assert.strictEqual(ran, false);
		assert.strictEqual(existsSync(commitGraphChainDir(repo.path)), false);
	});

	test('sibling worktrees coalesce on the shared common git dir', async () => {
		const worktreePath = `${repo.path}-mnt-wt`;
		addWorktree(repo.path, worktreePath, 'HEAD~1');
		try {
			// First write from the main worktree stamps the COMMON-dir throttle.
			await ensureCommitGraph(repo, repo.path);
			assert.strictEqual(existsSync(commitGraphChainDir(repo.path)), true);

			// Remove the evidence, then trigger from the SIBLING worktree: its own path isn't throttled,
			// but the shared common dir is — the write must coalesce (not re-run).
			rmSync(commitGraphChainDir(repo.path), { recursive: true, force: true });
			await ensureCommitGraph(repo, worktreePath);
			assert.strictEqual(
				existsSync(commitGraphChainDir(repo.path)),
				false,
				'the sibling worktree must coalesce into the common-dir throttle, not rewrite',
			);
		} finally {
			rmSync(worktreePath, { recursive: true, force: true });
		}
	});

	test('config-gated off is inert', async () => {
		const off = createTestRepo();
		try {
			addEmptyCommits(off.path, 2, 'o');
			const result = await ensureCommitGraph(off, off.path);
			assert.strictEqual(result, false, 'writeCommitGraph=false must report that no write completed');
			assert.strictEqual(existsSync(commitGraphChainDir(off.path)), false);
		} finally {
			off.cleanup();
		}
	});

	test('request() only drives a demand write for commit-graph; the daily-pass tasks no-op here', async () => {
		// Only the commit-graph has a demand cadence — loose-objects/incremental-repack are owned by the daily
		// pass, so `request(...)` must never write a commit-graph for them.
		for (const task of ['loose-objects', 'incremental-repack'] satisfies GitMaintenanceTask[]) {
			assert.strictEqual(maintenanceOf(repo).request(repo.path, task), undefined);
		}
		// Give any (erroneous) fire-and-forget work a turn to run; none should have been scheduled.
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.strictEqual(
			existsSync(commitGraphChainDir(repo.path)),
			false,
			'non-commit-graph tasks must not trigger a commit-graph write',
		);
	});
});

suite('maintenance commit-graph per-repository off switch (setCommitGraphDisabled)', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo({ config: { commits: {}, graph: { writeCommitGraph: true } } });
		addEmptyCommits(repo.path, 3, 'd');
	});

	teardown(() => {
		repo.cleanup();
	});

	test('disabling writes the gk.commitGraphDisabled marker and gates ensureCommitGraph', async () => {
		await maintenanceOf(repo).setCommitGraphDisabled(repo.path, true);
		assert.strictEqual(gkConfig(repo.path, 'gk.commitGraphDisabled'), 'true', 'marker written');

		await ensureCommitGraph(repo, repo.path);
		assert.strictEqual(
			existsSync(commitGraphChainDir(repo.path)),
			false,
			'the demand-cadence write must no-op while the marker is set',
		);
	});

	test('re-enabling clears the marker and the demand-cadence write resumes', async () => {
		await maintenanceOf(repo).setCommitGraphDisabled(repo.path, true);
		assert.strictEqual(gkConfig(repo.path, 'gk.commitGraphDisabled'), 'true', 'marker written');

		await maintenanceOf(repo).setCommitGraphDisabled(repo.path, false);
		assert.strictEqual(gkConfig(repo.path, 'gk.commitGraphDisabled'), undefined, 'marker cleared');

		await ensureCommitGraph(repo, repo.path);
		assert.strictEqual(
			existsSync(commitGraphChainDir(repo.path)),
			true,
			'the demand-cadence write must resume once re-enabled',
		);
	});

	test('re-enabling an already-absent marker is a no-op, not a failure', async () => {
		assert.strictEqual(gkConfig(repo.path, 'gk.commitGraphDisabled'), undefined, 'marker starts absent');
		await maintenanceOf(repo).setCommitGraphDisabled(repo.path, false);
		assert.strictEqual(gkConfig(repo.path, 'gk.commitGraphDisabled'), undefined, 'marker still absent');
	});

	test('getHealthSnapshot reports commitGraph.disabled from the marker', async () => {
		let snapshot = await maintenanceOf(repo).getHealthSnapshot(repo.path);
		assert.strictEqual(snapshot.commitGraph.disabled, false, 'not disabled by default');

		await maintenanceOf(repo).setCommitGraphDisabled(repo.path, true);
		snapshot = await maintenanceOf(repo).getHealthSnapshot(repo.path);
		assert.strictEqual(snapshot.commitGraph.disabled, true, 'reports disabled once the marker is set');

		await maintenanceOf(repo).setCommitGraphDisabled(repo.path, false);
		snapshot = await maintenanceOf(repo).getHealthSnapshot(repo.path);
		assert.strictEqual(snapshot.commitGraph.disabled, false, 'reports re-enabled once the marker is cleared');
	});
});

suite('maintenance commit-graph changed-path Bloom filters', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo({ config: { commits: {}, graph: { writeCommitGraph: true } } });
		addEmptyCommits(repo.path, 3, 'b');
	});

	teardown(() => {
		repo.cleanup();
	});

	test('a supporting git writes changed-path Bloom filters, reported in the health snapshot', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:commit-graph:changed-paths'));
		if (!supported) {
			this.skip();
		}

		await ensureCommitGraph(repo, repo.path);

		const chunkIds = await readNewestCommitGraphChunkIds(repo.path);
		assert.ok(chunkIds.includes('BIDX'), 'expected the newest graph layer to carry a BIDX chunk');

		const snapshot = await maintenanceOf(repo).getHealthSnapshot(repo.path);
		assert.strictEqual(snapshot.commitGraph.changedPaths, true);
	});

	test('a commit-graph written without --changed-paths reports changedPaths: false', async () => {
		const plainRepo = createTestRepo();
		try {
			addEmptyCommits(plainRepo.path, 3, 'p');
			execFileSync('git', ['commit-graph', 'write', '--reachable', '--split'], {
				cwd: plainRepo.path,
				stdio: 'pipe',
			});
			const snapshot = await maintenanceOf(plainRepo).getHealthSnapshot(plainRepo.path);
			assert.strictEqual(snapshot.commitGraph.changedPaths, false);
		} finally {
			plainRepo.cleanup();
		}
	});

	test('an explicit run replaces a plain chain with unbounded changed-path filters', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:commit-graph:changed-paths'));
		if (!supported) {
			this.skip();
		}

		execFileSync('git', ['commit-graph', 'write', '--reachable', '--split'], { cwd: repo.path, stdio: 'pipe' });
		assert.ok(!(await readNewestCommitGraphChunkIds(repo.path)).includes('BIDX'), 'starts without filters');

		const ran = await maintenanceOf(repo).runMaintenanceTask(repo.path, 'commit-graph');
		assert.strictEqual(ran, true);
		assert.ok((await readNewestCommitGraphChunkIds(repo.path)).includes('BIDX'), 'explicit run writes filters');

		const chain = readFileSync(join(commitGraphChainDir(repo.path), 'commit-graph-chain'), 'utf8')
			.split('\n')
			.filter(Boolean);
		assert.strictEqual(chain.length, 1, 'replace write folds the reachable history into one filtered layer');
	});

	test('automatic writes do not fetch missing trees in a partial clone', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:commit-graph'));
		if (!supported) {
			this.skip();
		}

		const source = createTestRepo();
		const cloneRoot = mkdtempSync(join(tmpdir(), 'gitlens-partial-clone-'));
		const partialPath = join(cloneRoot, 'partial');
		try {
			for (let i = 0; i < 12; i++) {
				addCommit(source.path, `dir-${i}/file.txt`, `content ${i}`, `partial ${i}`);
			}
			setConfig(source.path, 'uploadpack.allowFilter', 'true');
			execFileSync('git', ['clone', '--filter=tree:0', '--no-checkout', `file://${source.path}`, partialPath], {
				stdio: 'pipe',
			});
			assert.ok(
				execFileSync('git', ['config', '--local', '--get', 'remote.origin.promisor'], {
					cwd: partialPath,
					encoding: 'utf8',
				}).trim(),
				'fixture is a partial clone',
			);

			const before = objectCount(partialPath);
			const wrote = await maintenanceOf(repo).request(partialPath, 'commit-graph');
			const after = objectCount(partialPath);

			assert.strictEqual(wrote, true, 'the commit graph itself is still generated');
			assert.deepStrictEqual(after, before, 'no objects or promisor packs were fetched');
			const snapshot = await maintenanceOf(repo).getHealthSnapshot(partialPath);
			assert.strictEqual(snapshot.repository.partial, true, 'snapshot identifies the promisor clone');
			assert.strictEqual(
				snapshot.commitGraph.changedPaths,
				false,
				'filters are omitted when trees are not local',
			);
			assert.strictEqual(
				snapshot.commitGraph.changedPathsSupported,
				false,
				'the repo-level capability does not offer an explicit filter build that will intentionally be omitted',
			);
		} finally {
			source.cleanup();
			rmSync(cloneRoot, { recursive: true, force: true });
		}
	});
});
