import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as sinon from 'sinon';
import type { GitServiceConfig } from '@gitlens/git/context.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { assertGraphEquivalence, assertGraphsEquivalent, FlagsRowProcessor } from './graphEquivalence.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	cloneTestRepo,
	createBranch,
	createReplaceRef,
	createTestRepo,
	createWorktree,
	revParse,
} from './helpers.js';

suite('Graph ancestry validity', () => {
	let origin: TestRepo;

	suiteSetup(() => {
		origin = createTestRepo();
		for (let i = 0; i < 8; i++) {
			addCommit(origin.path, 'history.txt', `value ${i}\n`, `change ${i}`);
		}
	});

	suiteTeardown(() => {
		origin.cleanup();
	});

	test('partial deepening matches a fresh walk while the repository remains shallow', async () => {
		const clone = cloneTestRepo(origin.path, { depth: 2 });
		try {
			await assertGraphEquivalence(
				clone,
				path => {
					execFileSync('git', ['fetch', '--deepen=2', 'origin'], { cwd: path, stdio: 'pipe' });
					assert.strictEqual(
						execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
							cwd: path,
							encoding: 'utf8',
						}).trim(),
						'true',
					);
				},
				{ path: 'fallback', reason: 'shallow-changed' },
			);
		} finally {
			clone.cleanup();
		}
	});

	const modes = ['normal', 'first-parent', 'author-date', 'rebuild', 'changed-shape'] as const;
	const mutations = ['deepen', 'replace'] as const;

	async function assertAncestryRefresh(
		mode: (typeof modes)[number],
		mutation: (typeof mutations)[number],
	): Promise<void> {
		const config: GitServiceConfig = {
			commits: {},
			graph: {
				onlyFollowFirstParent: mode === 'first-parent',
				commitOrdering: mode === 'author-date' ? 'author-date' : 'date',
			},
		};
		const clone = cloneTestRepo(origin.path, {
			depth: mutation === 'deepen' ? 2 : undefined,
			config: config,
		});
		try {
			const session = await clone.provider.graph.openGraphSession(clone.path, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
			});
			await session.current.rowsStatsDeferred?.promise;
			const changedSha = session.window[1].sha;
			const priorParents = [...session.window[1].parents];
			const priorStats = session.current.rowsStats?.get(changedSha);
			if (mutation === 'deepen') {
				execFileSync('git', ['fetch', '--deepen=2', 'origin'], { cwd: clone.path, stdio: 'pipe' });
			} else {
				// Replacing with the root changes both parents and file stats for the same original sha.
				createReplaceRef(clone.path, changedSha, revParse(clone.path, 'HEAD~8'));
			}
			clone.provider.cache.onRepositoryChanged(clone.path, ['heads']);
			if (mode === 'changed-shape') {
				Object.assign(clone.provider.context.config!.graph!, { onlyFollowFirstParent: true });
			}
			const result = await session.refresh({ include: { stats: true }, rebuild: mode === 'rebuild' });
			await session.current.rowsStatsDeferred?.promise;
			const expected = await clone.provider.graph.getGraph(clone.path, undefined, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
			});
			await expected.rowsStatsDeferred?.promise;
			assert.strictEqual(result.path, 'full');
			assert.strictEqual(
				result.changed.rowsStatsRecomputed,
				true,
				'the host must replace same-sha parents and stats',
			);
			assert.notDeepStrictEqual(session.window.find(r => r.sha === changedSha)?.parents, priorParents);
			assert.notDeepStrictEqual(session.current.rowsStats?.get(changedSha), priorStats);
			assertGraphsEquivalent(expected, session.current, { includeStats: true });
		} finally {
			clone.cleanup();
		}
	}

	for (const mode of modes) {
		for (const mutation of mutations) {
			test(`${mutation} repairs parents and stats on a ${mode} refresh`, async () => {
				await assertAncestryRefresh(mode, mutation);
			});
		}
	}

	test('unchanged shallow ancestry retains the fast path and seeded stats', async () => {
		const clone = cloneTestRepo(origin.path, { depth: 3 });
		try {
			const session = await clone.provider.graph.openGraphSession(clone.path, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
			});
			await session.current.rowsStatsDeferred?.promise;
			const priorStats = [...session.current.rowsStats!];
			const result = await session.refresh({ include: { stats: true } });
			await session.current.rowsStatsDeferred?.promise;
			assert.strictEqual(result.path, 'fast');
			assert.strictEqual(result.changed.rowsStats, false);
			assert.deepStrictEqual([...session.current.rowsStats!], priorStats);
		} finally {
			clone.cleanup();
		}
	});

	test('boundary identity ignores line order while detecting same-size replacements', async () => {
		const clone = cloneTestRepo(origin.path, { depth: 4 });
		try {
			const path = `${clone.path}/.git/shallow`;
			const original = readFileSync(path, 'utf8').trim();
			const newer = revParse(clone.path, 'HEAD~1');
			writeFileSync(path, `${original}\n${newer}\n`);
			const session = await clone.provider.graph.openGraphSession(clone.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			writeFileSync(path, `${newer}\n${original}\n`);
			assert.strictEqual((await session.refresh()).path, 'fast');
			writeFileSync(path, `${original}\n${revParse(clone.path, 'HEAD')}\n`);
			const changed = await session.refresh();
			assert.strictEqual(changed.reason, 'shallow-changed');
			assert.strictEqual(changed.changed.rowsStatsRecomputed, true);
		} finally {
			clone.cleanup();
		}
	});

	test('stats-disabled ancestry repair still asks the host to replace parents', async () => {
		const clone = cloneTestRepo(origin.path, { depth: 2 });
		try {
			const session = await clone.provider.graph.openGraphSession(clone.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			execFileSync('git', ['fetch', '--deepen=2', 'origin'], { cwd: clone.path, stdio: 'pipe' });
			clone.provider.cache.onRepositoryChanged(clone.path, ['heads']);
			const result = await session.refresh();
			assert.strictEqual(result.changed.rowsStatsRecomputed, true);
			assert.strictEqual(session.window.length, 4);
			await session.refresh({ include: { stats: true }, rebuild: true });
			await session.current.rowsStatsDeferred?.promise;
			assert.strictEqual(session.current.rowsStats?.size, 4);
		} finally {
			clone.cleanup();
		}
	});

	test('a linked worktree reads the shared shallow boundary', async () => {
		const clone = cloneTestRepo(origin.path, { depth: 2 });
		let worktree: ReturnType<typeof createWorktree> | undefined;
		try {
			createBranch(clone.path, 'linked');
			worktree = createWorktree(clone.path, 'linked');
			const session = await clone.provider.graph.openGraphSession(worktree.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			assert.strictEqual(
				session.current.shallowBoundary,
				readFileSync(`${clone.path}/.git/shallow`, 'utf8').trim(),
			);
			execFileSync('git', ['fetch', '--deepen=2', 'origin'], { cwd: clone.path, stdio: 'pipe' });
			clone.provider.cache.onRepositoryChanged(worktree.path, ['heads']);
			const result = await session.refresh();
			assert.strictEqual(result.reason, 'shallow-changed');
			assert.strictEqual(session.window.length, 4);
		} finally {
			worktree?.cleanup();
			clone.cleanup();
		}
	});

	test('a bare shallow repository reads its boundary from the bare git directory', async () => {
		const clone = cloneTestRepo(origin.path);
		try {
			const barePath = `${clone.path}/bare.git`;
			execFileSync('git', ['clone', '--bare', '--depth=2', `file://${origin.path}`, barePath], { stdio: 'pipe' });
			const graph = await clone.provider.graph.getGraph(barePath, undefined, {
				rowProcessor: new FlagsRowProcessor(),
			});
			assert.strictEqual(graph.shallowBoundary, readFileSync(`${barePath}/shallow`, 'utf8').trim());
			assert.strictEqual(graph.rows.length, 2);
		} finally {
			clone.cleanup();
		}
	});

	test('unknown boundary reads never license same-sha stats reuse', async () => {
		const clone = cloneTestRepo(origin.path, { depth: 2 });
		try {
			const session = await clone.provider.graph.openGraphSession(clone.path, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
			});
			await session.current.rowsStatsDeferred?.promise;
			execFileSync('git', ['fetch', '--deepen=2', 'origin'], { cwd: clone.path, stdio: 'pipe' });
			clone.provider.cache.onRepositoryChanged(clone.path, ['heads']);
			const readFile = clone.provider.context.fs.readFile.bind(clone.provider.context.fs);
			const stub = sinon.stub(clone.provider.context.fs, 'readFile').callsFake(async uri => {
				if (uri.path.endsWith('/shallow')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
				return readFile(uri);
			});
			try {
				for (let i = 0; i < 2; i++) {
					const result = await session.refresh({ include: { stats: true } });
					await session.current.rowsStatsDeferred?.promise;
					assert.strictEqual(result.reason, 'shallow-changed');
					assert.strictEqual(result.changed.rowsStatsRecomputed, true);
					assert.strictEqual(session.current.shallowBoundary, undefined);
					assert.strictEqual(session.window.length, 4);
				}
			} finally {
				stub.restore();
			}
		} finally {
			clone.cleanup();
		}
	});

	test('cancellation racing a missing boundary propagates as cancellation', async () => {
		const repo = cloneTestRepo(origin.path);
		try {
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			const controller = new AbortController();
			const readFile = repo.provider.context.fs.readFile.bind(repo.provider.context.fs);
			const stub = sinon.stub(repo.provider.context.fs, 'readFile').callsFake(async uri => {
				if (uri.path.endsWith('/shallow')) {
					controller.abort();
					throw Object.assign(new Error('missing'), { code: 'ENOENT' });
				}
				return readFile(uri);
			});
			try {
				await assert.rejects(session.refresh(undefined, controller.signal), isCancellationError);
			} finally {
				stub.restore();
			}
			assert.strictEqual((await session.refresh()).path, 'fast', 'cancellation leaves the prior window reusable');
		} finally {
			repo.cleanup();
		}
	});

	test('a paged window preserves its ancestry generation until refresh and rejects queued old pages', async () => {
		const clone = cloneTestRepo(origin.path, { depth: 4 });
		try {
			const session = await clone.provider.graph.openGraphSession(clone.path, {
				rowProcessor: new FlagsRowProcessor(),
				limit: 2,
			});
			const boundary = session.current.shallowBoundary;
			await session.more(2);
			assert.strictEqual(session.current.shallowBoundary, boundary);
			const loaded = session.window.length;
			execFileSync('git', ['fetch', '--deepen=2', 'origin'], { cwd: clone.path, stdio: 'pipe' });
			clone.provider.cache.onRepositoryChanged(clone.path, ['heads']);
			const refreshed = session.refresh({ rev: session.window.at(-1)!.sha, limit: loaded });
			const queuedPage = session.more(2);
			assert.strictEqual((await refreshed).changed.rowsStatsRecomputed, true);
			assert.strictEqual(await queuedPage, 'superseded');
			assert.strictEqual(session.window.length, loaded);
			assert.strictEqual(session.current.paging?.hasMore, true);
			assert.notStrictEqual(session.current.shallowBoundary, boundary);
		} finally {
			clone.cleanup();
		}
	});
});
