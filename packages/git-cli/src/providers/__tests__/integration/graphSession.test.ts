/**
 * Integration tests for the provider-owned {@link GitGraphSession} (R7a). The session is a stateful
 * facade over `getGraph`: it owns the canonical accumulated window, builds the incremental seed
 * internally (so `refresh` takes the R6b fast path after a commit), maintains the window across `more()`
 * pagination (page-scoped `current` vs full `window`), merges avatars write-once across generations, and
 * honors the walk shape. These assert the session's own behavior — the 21 `getGraph` equivalence
 * scenarios still pin the underlying walk.
 */

import * as assert from 'assert';
import type {
	GitGraphRow,
	GraphContext,
	GraphReachabilityTable,
	GraphRowProcessor,
} from '@gitlens/git/models/graph.js';
import type {
	GitGraphSession,
	GitGraphSessionSnapshot,
	GraphSessionRestoreResult,
} from '@gitlens/git/models/graphSession.js';
import { graphSessionSnapshotVersion } from '@gitlens/git/models/graphSession.js';
import {
	computeGraphRowContextFlags,
	decodeReachabilitySet,
	reachableRefKey,
} from '@gitlens/git/utils/reachability.utils.js';
import { assertGraphsEquivalent, FlagsRowProcessor } from './graphEquivalence.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	addEmptyCommits,
	cloneTestRepo,
	createBranch,
	createReplaceRef,
	createTag,
	createTestRepo,
	createTrackingBranch,
	deleteBranch,
	getHeadSha,
	revParse,
} from './helpers.js';

/** Like {@link FlagsRowProcessor} but also seeds an avatar URL per author email — so the walk's avatar map
 *  grows when a commit introduces a NEW email, exercising the session's `changed.avatars` derivation. */
class AvatarSeedingRowProcessor implements GraphRowProcessor {
	processRow(row: GitGraphRow, context: GraphContext): void {
		if (row.type === 'stash-node') return;

		(row.contexts ??= {}).flags = computeGraphRowContextFlags(row.sha, row.reachability?.refs, context);
		if (context.useAvatars) {
			context.avatars.set(row.email, `https://avatars.example/${row.email}`);
		}
	}
}

suite('GitGraphSession (R7a)', () => {
	test('refresh after a commit takes the incremental fast path', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 20, 's');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			const initialSize = session.window.length;
			assert.ok(initialSize > 0, 'initial window should be populated');

			// A new commit at head, then refresh — the session seeds the fast path from its own window.
			addCommit(repo.path, 'top.txt', 'top', 'New head commit');
			repo.provider.cache.clearCaches(repo.path);

			const result = await session.refresh();

			assert.strictEqual(result.path, 'fast', 'expected the incremental fast path');
			assert.strictEqual(result.added, 1, 'exactly one new commit was enumerated');
			assert.strictEqual(result.reason, undefined, 'the fast path carries no fallback reason');
			assert.strictEqual(session.window.length, initialSize + 1, 'the new commit grew the window by one');
			assert.strictEqual(session.window[0].sha, getHeadSha(repo.path), 'the new commit is at the window head');
		} finally {
			repo.cleanup();
		}
	});

	test('window accumulates across more() while current stays page-scoped', async () => {
		const repo = createTestRepo();
		try {
			// Enough linear history to page across a limit boundary.
			addEmptyCommits(repo.path, 40, 'p');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				limit: 10,
			});
			assert.strictEqual(session.window.length, 10, 'first page is 10 rows');
			assert.strictEqual(session.current.rows.length, 10, 'current mirrors the first page');
			assert.strictEqual(session.current.paging?.hasMore, true, 'more history remains');
			const firstPageSize = session.window.length;

			const gotMore = await session.more(10);
			assert.strictEqual(gotMore, true, 'more() reported new rows');

			// The window ACCUMULATES the pages; `current.rows` is only the last (page-scoped) page. The page
			// appends at the first page's bottom cursor, so `window = firstPage + page` (git's `--skip` re-reads
			// the cursor row and dedups it, so a page after the first can carry fewer than `limit` new rows).
			const pageSize = session.current.rows.length;
			assert.ok(pageSize > 0, 'the page carried rows');
			assert.strictEqual(session.window.length, firstPageSize + pageSize, 'window = first page + appended page');
			assert.ok(session.window.length > firstPageSize, 'the window accumulated');
			assert.ok(pageSize < session.window.length, 'current is page-scoped — smaller than the full window');
			// The window is a superset of the page and the first page's head is still present.
			const windowShas = new Set(session.window.map(r => r.sha));
			for (const row of session.current.rows) {
				assert.ok(windowShas.has(row.sha), 'every page row is in the window');
			}
			assert.strictEqual(session.window[0].sha, getHeadSha(repo.path), 'the window head is still HEAD');
		} finally {
			repo.cleanup();
		}
	});

	test('a paged window survives (and extends across) a refresh', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 40, 'p');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				limit: 10,
			});
			await session.more(10);
			await session.more(10);
			const pagedSize = session.window.length;
			assert.ok(pagedSize > 20, 'paged the window well past the first page');
			const oldestLoadedSha = session.window.at(-1)!.sha;

			// Rebuild anchored on the window's bottom (like the host) so the re-walk spans the whole window.
			addCommit(repo.path, 'top.txt', 'top', 'New head commit');
			repo.provider.cache.clearCaches(repo.path);
			await session.refresh({ rev: oldestLoadedSha, limit: pagedSize });

			const shas = new Set(session.window.map(r => r.sha));
			assert.ok(shas.has(getHeadSha(repo.path)), 'the new head is in the refreshed window');
			assert.ok(shas.has(oldestLoadedSha), 'the previously-paged bottom row survived the refresh');
		} finally {
			repo.cleanup();
		}
	});

	test('avatars resolved on one generation carry forward across a refresh (write-once)', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 5, 's');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});

			// Simulate a resolved avatar (the host mutates `current.avatars` on GetMissingAvatars/ProxyAvatars).
			session.current.avatars.set('resolved@example.com', 'https://avatar.example/resolved.png');

			addCommit(repo.path, 'top.txt', 'top', 'New head commit');
			repo.provider.cache.clearCaches(repo.path);
			await session.refresh();

			assert.strictEqual(
				session.current.avatars.get('resolved@example.com'),
				'https://avatar.example/resolved.png',
				'the prior generation avatar was merged into the fresh graph',
			);
		} finally {
			repo.cleanup();
		}
	});

	test('a first-parent walk shape discards the fast path (full walk)', async () => {
		// The session threads the walk shape into the seed; a first-parent shape can't reuse the cached
		// (sliced-parent) rows, so the provider falls back to a full walk.
		const repo = createTestRepo({ config: { commits: {}, graph: { onlyFollowFirstParent: true } } });
		try {
			addEmptyCommits(repo.path, 10, 's');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});

			addCommit(repo.path, 'top.txt', 'top', 'New head commit');
			repo.provider.cache.clearCaches(repo.path);
			const result = await session.refresh();

			assert.strictEqual(result.path, 'full', 'a first-parent shape must take the full walk');
			assert.strictEqual(result.reason, 'first-parent', 'the fallback reason is surfaced');
			assert.strictEqual(session.window[0].sha, getHeadSha(repo.path), 'the full walk still landed the new head');
		} finally {
			repo.cleanup();
		}
	});

	test('dispose is idempotent and leaves the last window readable', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 3, 's');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			const size = session.window.length;

			session.dispose();
			session.dispose();

			assert.strictEqual(session.window.length, size, 'the window is still readable after dispose');
		} finally {
			repo.cleanup();
		}
	});
});

/**
 * R7b: `refresh` reports, per rows-plane channel, exactly what its walk changed — so the host can mark the
 * publisher precisely instead of dirtying all six channels every refresh. The full path reports everything
 * changed; the fast path derives each flag honestly from its own work (a false negative would be data loss,
 * so a channel is `false` only when it PROVABLY didn't change). `refsMetadata` is host-owned and excluded.
 */
suite('GitGraphSession refresh channel-change reporting (R7b)', () => {
	test('refresh({ rebuild: true }) skips the incremental seed for one unseeded full walk', async () => {
		// The host uses `rebuild` for invalidations the provider can't observe (pinned refs, integration
		// connections) whose values are baked into reused rows' serialized contexts.
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 5, 'r');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});

			addCommit(repo.path, 'a.txt', 'a', 'Head commit');
			repo.provider.cache.clearCaches(repo.path);
			const forced = await session.refresh({ rebuild: true });
			assert.strictEqual(forced.path, 'full', 'rebuild must force the full walk');
			assert.strictEqual(forced.reason, undefined, 'an unseeded full walk carries no fallback reason');

			// One-shot: the next plain refresh is seeded (and fast) again.
			addCommit(repo.path, 'b.txt', 'b', 'Second head commit');
			repo.provider.cache.clearCaches(repo.path);
			const next = await session.refresh();
			assert.strictEqual(next.path, 'fast', 'a plain refresh after a rebuild is seeded again');
		} finally {
			repo.cleanup();
		}
	});

	test('a commit at head reports rows + reachability + rowsStats changed (no new emails / downstreams)', async () => {
		const repo = createTestRepo();
		try {
			// A tag at the head makes the new head commit's reachable set ({main} alone) NOVEL — every prior
			// commit is {main, v1.0} — so the reachability table genuinely grows a set.
			addEmptyCommits(repo.path, 10, 's');
			createTag(repo.path, 'v1.0');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
			});

			addCommit(repo.path, 'top.txt', 'top', 'New head commit');
			repo.provider.cache.clearCaches(repo.path);
			const result = await session.refresh({ include: { stats: true } });

			assert.strictEqual(result.path, 'fast', 'expected the incremental fast path');
			assert.strictEqual(result.added, 1);
			assert.strictEqual(result.changed.rows, true, 'a head-walk always reshapes the rows window');
			assert.strictEqual(result.changed.reachability, true, 'the novel head set grew the reachability table');
			assert.strictEqual(result.changed.rowsStats, true, 'a new commit sha queues new stats');
			assert.strictEqual(result.changed.avatars, false, 'the flags-only processor introduces no avatar emails');
			assert.strictEqual(result.changed.downstreams, false, 'no tracked upstreams → downstreams unchanged');
		} finally {
			repo.cleanup();
		}
	});

	test('a tag add reports rows + reachability changed but NOT rowsStats (no new commits)', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 10, 's');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
			});

			createTag(repo.path, 'v2.0');
			repo.provider.cache.clearCaches(repo.path);
			const result = await session.refresh({ include: { stats: true } });

			assert.strictEqual(result.path, 'fast', 'a tag add takes the fast path');
			assert.strictEqual(result.added, 0, 'a tag adds no new commits');
			assert.strictEqual(result.changed.rows, true, 'the decoration refetch reshapes the tagged row');
			assert.strictEqual(result.changed.reachability, true, 'the new tag ref grew the reachability dictionary');
			assert.strictEqual(result.changed.rowsStats, false, 'no new commit shas → no new stats to ship');
			assert.strictEqual(result.changed.downstreams, false);
		} finally {
			repo.cleanup();
		}
	});

	test('rowsStats stays false on a fast refresh when stats were never requested', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 5, 's');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				// No `include.stats` — the rowsStats channel has nothing to ship even for new commits.
			});

			addCommit(repo.path, 'top.txt', 'top', 'New head commit');
			repo.provider.cache.clearCaches(repo.path);
			const result = await session.refresh();

			assert.strictEqual(result.path, 'fast');
			assert.strictEqual(result.added, 1);
			assert.strictEqual(result.changed.rowsStats, false, 'no stats requested → rowsStats never marked');
		} finally {
			repo.cleanup();
		}
	});

	test('a full-walk fallback reports every channel changed', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 5, 's');
			createBranch(repo.path, 'feature'); // an extra ref whose deletion forces a full fallback
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
			});

			deleteBranch(repo.path, 'feature');
			repo.provider.cache.clearCaches(repo.path);
			const result = await session.refresh({ include: { stats: true } });

			assert.strictEqual(result.path, 'full', 'a ref deletion forces the full walk');
			assert.strictEqual(result.reason, 'ref-deleted');
			assert.deepStrictEqual(
				result.changed,
				{
					rows: true,
					reachability: true,
					rowsStats: true,
					// A ref deletion rewrites no parents — existing shas' stats are still valid.
					rowsStatsRecomputed: false,
					avatars: true,
					downstreams: true,
				},
				'a fresh walk replaces everything',
			);
		} finally {
			repo.cleanup();
		}
	});

	test('a parent-rewriting fallback reports rowsStatsRecomputed (replace ref)', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 5, 's');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
			});

			// A replace ref retargets a parent — existing shas' true diffs change, so the fallback drops
			// the stats seed and recomputes; the report must tell the host to resend, not just append.
			createReplaceRef(repo.path, revParse(repo.path, 'HEAD~1'), revParse(repo.path, 'HEAD~2'));
			repo.provider.cache.clearCaches(repo.path);
			const result = await session.refresh({ include: { stats: true } });

			assert.strictEqual(result.path, 'full', 'a replace-ref change forces the full walk');
			assert.strictEqual(result.reason, 'replace-refs-changed');
			assert.strictEqual(result.changed.rowsStatsRecomputed, true, 'recomputed stats must be resent');
		} finally {
			repo.cleanup();
		}
	});

	test('avatars changed is reported only when a commit introduces a NEW email', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 5, 's');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new AvatarSeedingRowProcessor(),
			});

			// A commit by a DIFFERENT author → a new avatar email enters the map → avatars changed.
			addCommit(repo.path, 'other.txt', 'o', 'Commit by another author', {
				author: { name: 'Other Dev', email: 'other@example.test' },
			});
			repo.provider.cache.clearCaches(repo.path);
			const first = await session.refresh();
			assert.strictEqual(first.path, 'fast');
			assert.strictEqual(first.changed.avatars, true, 'a new author email grew the avatar map');

			// A follow-up commit by the ORIGINAL author adds no new email → avatars unchanged.
			addCommit(repo.path, 'same.txt', 's', 'Commit by the original author');
			repo.provider.cache.clearCaches(repo.path);
			const second = await session.refresh();
			assert.strictEqual(second.path, 'fast');
			assert.strictEqual(second.changed.avatars, false, 'a same-email commit introduces no new avatar');
		} finally {
			repo.cleanup();
		}
	});

	test('downstreams changed only when the upstream→branches map actually changes', async () => {
		const origin = createTestRepo();
		try {
			addEmptyCommits(origin.path, 5, 'o');
			const clone = cloneTestRepo(origin.path);
			try {
				// The clone's `main` tracks `origin/main` → baseline downstreams { origin/main: [main] }.
				const session = await clone.provider.graph.openGraphSession(clone.path, {
					rowProcessor: new FlagsRowProcessor(),
					include: { stats: true },
				});

				// A plain new commit moves main's tip but not the upstream→branches map.
				addCommit(clone.path, 'top.txt', 'top', 'New head commit');
				clone.provider.cache.clearCaches(clone.path);
				const first = await session.refresh({ include: { stats: true } });
				assert.strictEqual(first.path, 'fast');
				assert.strictEqual(first.changed.downstreams, false, 'a commit does not change the downstreams map');

				// A second local branch tracking origin/main ADDS a downstream entry.
				createTrackingBranch(clone.path, 'feature2', 'origin/main');
				clone.provider.cache.clearCaches(clone.path);
				const second = await session.refresh({ include: { stats: true } });
				assert.strictEqual(second.path, 'fast');
				assert.strictEqual(second.changed.downstreams, true, 'a new tracking branch grew the downstreams map');
			} finally {
				clone.cleanup();
			}
		} finally {
			origin.cleanup();
		}
	});
});

/**
 * R7c restart persistence: `serialize()` snapshots the canonical window; `openGraphSession({ restore })`
 * reconstructs it as an R6 seed WITHOUT git and immediately refreshes — so a stale snapshot heals (fast when
 * unchanged, a full walk on any structural change) and a corrupt/mismatched one is discarded for a normal
 * initial walk. The gate is byte-equivalence: restore+refresh == a fresh walk of the same shape. Snapshots
 * are round-tripped through JSON (as real persistence does) so a non-JSON-safe field would fail loudly.
 */
suite('GitGraphSession restart persistence (R7c)', () => {
	/** The window's BOTTOM commit/merge sha — the restore's re-walk anchor (mirrors the host's rebuild anchor). */
	function windowBottomAnchor(window: readonly GitGraphRow[]): string | undefined {
		for (let i = window.length - 1; i >= 0; i--) {
			const type = window[i].type;
			if (type === 'commit-node' || type === 'merge-node') return window[i].sha;
		}
		return undefined;
	}

	/** Serialize a session and round-trip it through JSON exactly as persistence does (catching any non-JSON-safe field). */
	function roundTripSnapshot(session: GitGraphSession): GitGraphSessionSnapshot {
		const snapshot = session.serialize();
		assert.ok(snapshot != null, 'a populated session should produce a snapshot');
		return JSON.parse(JSON.stringify(snapshot)) as GitGraphSessionSnapshot;
	}

	/** A row minus `reachabilityIndex` (compared via decoded membership) and the stripped transient, JSON-
	 *  normalized so a round-tripped reused row's dropped `undefined` keys compare equal to a fresh row's. */
	function normalizeRow(row: GitGraphRow): unknown {
		const { reachability: _r, contexts, ...rest } = row;
		let ctx;
		if (contexts != null) {
			const { reachabilityIndex: _i, ...c } = contexts;
			ctx = c;
		}
		return JSON.parse(JSON.stringify({ ...rest, contexts: ctx }));
	}

	/** A row's reachable-ref set decoded from a table, sorted canonically (index divergence is expected). */
	function decodedMembership(table: GraphReachabilityTable | undefined, row: GitGraphRow): unknown[] {
		const index = row.contexts?.reachabilityIndex;
		if (index == null || table == null) return [];
		return [...decodeReachabilitySet(table, index)].sort((a, b) =>
			reachableRefKey(a) < reachableRefKey(b) ? -1 : reachableRefKey(a) > reachableRefKey(b) ? 1 : 0,
		);
	}

	/** Compare two sessions' ACCUMULATED windows row-for-row (each row decoded against its own session's table). */
	function assertWindowsEquivalent(expected: GitGraphSession, actual: GitGraphSession): void {
		const e = expected.window;
		const a = actual.window;
		assert.strictEqual(a.length, e.length, `window length: expected ${e.length}, actual ${a.length}`);
		for (let i = 0; i < e.length; i++) {
			assert.deepStrictEqual(
				normalizeRow(a[i]),
				normalizeRow(e[i]),
				`window row ${i} (sha ${e[i].sha}) diverges`,
			);
			assert.deepStrictEqual(
				decodedMembership(actual.current.reachability, a[i]),
				decodedMembership(expected.current.reachability, e[i]),
				`window row ${i} (sha ${e[i].sha}) reachability diverges`,
			);
		}
	}

	/**
	 * Full harness for scenarios (a)–(c): build a session → snapshot it → optionally mutate the repo offline →
	 * assert restore+refresh took `expectedRefresh` AND is byte-equivalent to a FRESH walk of the same shape
	 * (same bottom anchor + window limit, so paging/id align). The fresh walk mints a new reachability table
	 * while restore continues the snapshot's — so equivalence is by DECODED membership, never raw index.
	 */
	async function assertRestoreMatchesFreshWalk(
		repo: TestRepo,
		mutate: ((repoPath: string) => void | Promise<void>) | undefined,
		expectedRefresh: { path: 'fast' | 'full'; reason?: string; added?: number },
	): Promise<void> {
		const { provider, path: repoPath } = repo;

		const first = await provider.graph.openGraphSession(repoPath, {
			rowProcessor: new FlagsRowProcessor(),
			include: { stats: true },
		});
		await first.current.rowsStatsDeferred?.promise;
		const anchor = windowBottomAnchor(first.window);
		const windowLength = first.window.length;
		const snapshot = roundTripSnapshot(first);
		first.dispose();

		if (mutate != null) {
			await mutate(repoPath);
			provider.cache.clearCaches(repoPath);
		}

		// EXPECTED: a fresh walk of the SAME shape as the restore's internal re-walk (anchor + window limit).
		const expected = await provider.graph.getGraph(repoPath, anchor, {
			include: { stats: true },
			rowProcessor: new FlagsRowProcessor(),
			limit: windowLength,
		});
		await expected.rowsStatsDeferred?.promise;

		// ACTUAL: restore + immediate refresh.
		let result: GraphSessionRestoreResult | undefined;
		const restored = await provider.graph.openGraphSession(repoPath, {
			rowProcessor: new FlagsRowProcessor(),
			include: { stats: true },
			restore: snapshot,
			onRestore: r => {
				result = r;
			},
		});
		await restored.current.rowsStatsDeferred?.promise;

		assert.strictEqual(result?.restored, true, 'the snapshot was restored');
		assert.strictEqual(result?.rows, snapshot.rows.length, 'the reported restored-row count matches the snapshot');
		assert.strictEqual(result?.refresh?.path, expectedRefresh.path, 'restore refresh path');
		assert.strictEqual(result?.refresh?.reason, expectedRefresh.reason, 'restore refresh fallback reason');
		if (expectedRefresh.added != null) {
			assert.strictEqual(result?.refresh?.added, expectedRefresh.added, 'restore refresh added count');
		}
		assertGraphsEquivalent(expected, restored.current, { includeStats: true });
		restored.dispose();
	}

	test('(a) unchanged repo → restore refresh fast +0, byte-equivalent to a fresh walk', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 20, 's');
			createTag(repo.path, 'v1.0'); // a ref for reachability variety
			await assertRestoreMatchesFreshWalk(repo, undefined, { path: 'fast', added: 0 });
		} finally {
			repo.cleanup();
		}
	});

	test('(b) commits added while closed → restore refresh fast, byte-equivalent', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 15, 's');
			await assertRestoreMatchesFreshWalk(
				repo,
				path => {
					addCommit(path, 'top1.txt', 'top1', 'Offline commit 1');
					addCommit(path, 'top2.txt', 'top2', 'Offline commit 2');
				},
				{ path: 'fast', added: 2 },
			);
		} finally {
			repo.cleanup();
		}
	});

	test('(c) branch deleted while closed → restore refresh falls back full, byte-equivalent', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 12, 's');
			createBranch(repo.path, 'feature'); // an extra ref whose deletion forces a full fallback
			await assertRestoreMatchesFreshWalk(repo, path => deleteBranch(path, 'feature'), {
				path: 'full',
				reason: 'ref-deleted',
			});
		} finally {
			repo.cleanup();
		}
	});

	test('(d) a structurally corrupt/truncated snapshot is ignored (clean initial walk, no throw)', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 8, 's');
			const first = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			const good = roundTripSnapshot(first);
			first.dispose();

			// Truncated: a required field went missing (as a partial write / clipped JSON would produce).
			const truncated = { ...good, refTips: undefined } as unknown as GitGraphSessionSnapshot;
			// Corrupt: a row's reachabilityIndex points past the table's sets.
			const corruptIndex: GitGraphSessionSnapshot = {
				...good,
				rows: good.rows.map((r, i) =>
					i === 0 ? { ...r, contexts: { ...r.contexts, reachabilityIndex: 999_999 } } : r,
				),
			};

			for (const [snapshot, reason] of [
				[truncated, 'tips'],
				[corruptIndex, 'reachability'],
			] as const) {
				let result: GraphSessionRestoreResult | undefined;
				const session = await repo.provider.graph.openGraphSession(repo.path, {
					rowProcessor: new FlagsRowProcessor(),
					restore: snapshot,
					onRestore: r => {
						result = r;
					},
				});
				assert.strictEqual(result?.restored, false, `corrupt snapshot (${reason}) is not restored`);
				assert.strictEqual(result?.reason, reason, `corrupt snapshot discard reason (${reason})`);
				assert.strictEqual(
					session.window[0].sha,
					getHeadSha(repo.path),
					'a normal initial walk still loaded HEAD',
				);
				session.dispose();
			}
		} finally {
			repo.cleanup();
		}
	});

	test('(e) a schemaVersion mismatch is ignored (clean initial walk)', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 6, 's');
			const first = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			const stale: GitGraphSessionSnapshot = { ...roundTripSnapshot(first), v: graphSessionSnapshotVersion + 1 };
			first.dispose();

			let result: GraphSessionRestoreResult | undefined;
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				restore: stale,
				onRestore: r => {
					result = r;
				},
			});
			assert.strictEqual(result?.restored, false, 'a schema mismatch is not restored');
			assert.strictEqual(result?.reason, 'schema', 'the discard reason is a schema mismatch');
			assert.strictEqual(session.window[0].sha, getHeadSha(repo.path), 'a normal initial walk still loaded HEAD');
			session.dispose();
		} finally {
			repo.cleanup();
		}
	});

	test('(f) a paged (hasMore) window restores its top slice and re-pages below it, byte-equivalent', async () => {
		// A genuinely-paged window (hasMore=true from a small limit) is structurally identical to what
		// serialize() produces when it CAPS a window larger than `maxPersistedGraphRows` to its top slice (top
		// rows + hasMore forced true) — a 2000+-row capped window is cost-prohibitive to build live, so this
		// paged window exercises the identical restore + re-page path.
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 40, 'p');

			// EXPECTED: a fresh paged session; snapshot its top (hasMore) slice, then page once more for the baseline.
			const expected = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
				limit: 10,
			});
			await expected.current.rowsStatsDeferred?.promise;
			const snapshot = roundTripSnapshot(expected);
			assert.strictEqual(snapshot.hasMore, true, 'a paged window persists hasMore (the capped-top-slice shape)');
			const topSliceLength = snapshot.rows.length;
			await expected.more(10);
			await expected.current.rowsStatsDeferred?.promise;

			// ACTUAL: restore the top slice (→ hasMore), then page once more.
			let result: GraphSessionRestoreResult | undefined;
			const restored = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				include: { stats: true },
				restore: snapshot,
				onRestore: r => {
					result = r;
				},
			});
			await restored.current.rowsStatsDeferred?.promise;

			assert.strictEqual(result?.restored, true, 'the paged snapshot was restored');
			assert.strictEqual(result?.refresh?.path, 'fast', 'an unchanged repo restores fast');
			assert.strictEqual(restored.window.length, topSliceLength, 'restore yields exactly the top slice');
			assert.strictEqual(restored.current.paging?.hasMore, true, 'with hasMore, so the bottom re-pages');

			await restored.more(10);
			await restored.current.rowsStatsDeferred?.promise;

			// The re-paged window matches a fresh walk of the same shape, row-for-row.
			assert.ok(restored.window.length > topSliceLength, 'more() paged below the restored top slice');
			assertWindowsEquivalent(expected, restored);
			expected.dispose();
			restored.dispose();
		} finally {
			repo.cleanup();
		}
	});

	test('(g) a replace ref added while closed → restore refresh falls back full, byte-equivalent', async () => {
		// The snapshot is captured with NO replacement; a `git replace` added offline moves no branch tip, so
		// only the replace-ref gate catches it — the restore refresh must fall back to a full walk (the cached
		// rows' parent links are built under the old ancestry view) and stay byte-equivalent to a fresh walk.
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 12, 's'); // interior commits to replace
			await assertRestoreMatchesFreshWalk(
				repo,
				path => createReplaceRef(path, revParse(path, 'HEAD~2'), revParse(path, 'HEAD~3')),
				{ path: 'full', reason: 'replace-refs-changed' },
			);
		} finally {
			repo.cleanup();
		}
	});
});
