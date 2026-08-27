/**
 * Integration tests for the provider-owned {@link GitGraphSession} (R7a). The session is a stateful
 * facade over `getGraph`: it owns the canonical accumulated window, builds the incremental seed
 * internally (so `refresh` takes the R6b fast path after a commit), maintains the window across `more()`
 * pagination (page-scoped `current` vs full `window`), merges avatars write-once across generations, and
 * honors the walk shape. These assert the session's own behavior — the `getGraph` equivalence scenarios in
 * `graph.incremental.test.ts` still pin the underlying walk byte-for-byte.
 */

import * as assert from 'assert';
import type { GitGraphRow, GraphContext, GraphRowProcessor } from '@gitlens/git/models/graph.js';
import { GitGraphRowContextFlags } from '@gitlens/git/models/graph.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import { computeGraphRowContextFlags } from '@gitlens/git/utils/reachability.utils.js';
import { FlagsRowProcessor } from './graphEquivalence.js';
import {
	addCommit,
	addEmptyCommits,
	checkout,
	cloneTestRepo,
	createBranch,
	createBranchAt,
	createReplaceRef,
	createStash,
	createTag,
	createTestRepo,
	createTrackingBranch,
	createWorktree,
	deleteBranch,
	getHeadSha,
	push,
	revParse,
	setBranchGkDisposition,
	setUpstream,
} from './helpers.js';

/**
 * Like {@link FlagsRowProcessor} but records which rows `restampRow` was invoked for, so a rebind can
 * assert the re-stamp pass runs over REUSED decorated rows and skips the ones the fast path already
 * rebuilt from raw git at the new path. Recording only: the ref-id prefix swap is the PROVIDER's job
 * (the walk stamps those ids), while production's `GlGraphRowProcessor.restampRow` rebuilds the
 * serialized webview-item contexts that embed the repoPath.
 */
class RestampTrackingRowProcessor extends FlagsRowProcessor {
	readonly restamped = new Set<string>();

	restampRow(row: GitGraphRow, _fromRepoPath: string, _toRepoPath: string, _context: GraphContext): void {
		this.restamped.add(row.sha);
	}
}

/**
 * Like {@link FlagsRowProcessor} but also builds a serialized STASH row context embedding
 * `context.repoPath` — the one host-serialized blob a rebind has to rebuild (production's
 * `GlGraphRowProcessor` does the same via `buildStashRowContext`). Kept deliberately minimal: the point is
 * that the blob carries the repoPath, not that it matches the host's exact shape.
 */
class StashContextRowProcessor extends FlagsRowProcessor {
	override processRow(row: GitGraphRow, context: GraphContext): void {
		super.processRow(row, context);
		if (row.kind === 'stash') {
			(row.contexts ??= {}).row = JSON.stringify({ type: 'stash', repoPath: context.repoPath, sha: row.sha });
		}
	}

	restampRow(row: GitGraphRow, _fromRepoPath: string, _toRepoPath: string, context: GraphContext): void {
		if (row.kind !== 'stash' || row.contexts?.row == null) return;

		row.contexts = {
			...row.contexts,
			row: JSON.stringify({ type: 'stash', repoPath: context.repoPath, sha: row.sha }),
		};
	}
}

/**
 * Once `armed`, fails a rebind PARTWAY THROUGH the re-stamp and then fails the full walk it degrades to —
 * the only sequence that can leave the session holding a window whose ids were half-moved to the new path.
 * `restampRow` throws first (so the rows before it are already re-stamped in place), and `processRow` only
 * starts throwing afterwards, so the fast path gets far enough to mutate before everything collapses.
 */
class ExplodingRowProcessor extends FlagsRowProcessor {
	armed = false;
	private restampThrew = false;

	override processRow(row: GitGraphRow, context: GraphContext): void {
		if (this.armed && this.restampThrew) throw new Error('row processing exploded');

		super.processRow(row, context);
	}

	restampRow(_row: GitGraphRow, _fromRepoPath: string, _toRepoPath: string, _context: GraphContext): void {
		if (!this.armed) return;

		this.restampThrew = true;
		throw new Error('row re-stamping exploded');
	}
}

/** Like {@link FlagsRowProcessor} but also seeds an avatar URL per author email — so the walk's avatar map
 *  grows when a commit introduces a NEW email, exercising the session's `changed.avatars` derivation. */
class AvatarSeedingRowProcessor implements GraphRowProcessor {
	processRow(row: GitGraphRow, context: GraphContext): void {
		if (row.kind === 'stash') return;

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

	test('refresh on an unchanged repo takes the fast path and adds nothing', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 20, 's');
			createTag(repo.path, 'v1.0'); // a ref for reachability variety
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			const initialSize = session.window.length;
			assert.ok(initialSize > 0, 'initial window should be populated');

			repo.provider.cache.clearCaches(repo.path);

			const result = await session.refresh();

			assert.strictEqual(result.path, 'fast', 'expected the incremental fast path');
			assert.strictEqual(result.added, 0, 'an unchanged repo enumerates no new commits');
			assert.strictEqual(result.reason, undefined, 'the fast path carries no fallback reason');
			assert.strictEqual(session.window.length, initialSize, 'the window is unchanged in size');
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
 * Rebind: re-perspective a live session onto another worktree of the SAME repo family without discarding
 * the accumulated window. Nothing in the repo changed — only which checkout the graph is "standing in" —
 * so this must ride the R6b fast path: unchanged tips, the HEAD endpoints refetched from the new cwd, and
 * every reused row's repoPath-derived ref ids re-stamped in place. A `'full'` result is a test failure.
 */
suite('GitGraphSession rebind (worktree re-perspective)', () => {
	/**
	 * Repo with `main` checked out and a `feature` worktree one commit ahead, plus two decorated rows
	 * (`other`, tag `v1.0`) sitting well below both HEADs so they're REUSED — never in the fast path's
	 * `affected` refetch set — and therefore only correct if the re-stamp pass ran.
	 */
	function createRebindFixture() {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 5, 'a');
			createTag(repo.path, 'v1.0');
			addEmptyCommits(repo.path, 5, 'b');
			createBranchAt(repo.path, 'other', 'HEAD~2');
			createBranch(repo.path, 'feature');
			const worktree = createWorktree(repo.path, 'feature');
			try {
				addCommit(worktree.path, 'f.txt', 'f', 'Feature-only commit');
			} catch (ex) {
				worktree.cleanup();
				throw ex;
			}

			return {
				repo: repo,
				worktree: worktree,
				mainPath: repo.path,
				wtPath: worktree.path,
				mainTip: revParse(repo.path, 'main'),
				featureTip: revParse(worktree.path, 'HEAD'),
				otherTip: revParse(repo.path, 'other'),
				taggedSha: revParse(repo.path, 'v1.0'),
				cleanup: () => {
					worktree.cleanup();
					repo.cleanup();
				},
			};
		} catch (ex) {
			repo.cleanup();
			throw ex;
		}
	}

	/** Every ref id a row embeds — the repoPath-stamped fields the rebind has to swap. */
	function rowRefIds(rows: readonly GitGraphRow[]): string[] {
		const ids: string[] = [];
		for (const row of rows) {
			for (const head of row.heads ?? []) {
				if (head.id != null) {
					ids.push(head.id);
				}
				if (head.upstream != null) {
					ids.push(head.upstream.id);
				}
				if (head.worktree != null) {
					ids.push(head.worktree.id);
				}
			}
			for (const remote of row.remotes ?? []) {
				if (remote.id != null) {
					ids.push(remote.id);
				}
			}
			for (const tag of row.tags ?? []) {
				if (tag.id != null) {
					ids.push(tag.id);
				}
			}
		}
		return ids;
	}

	test('rebinding onto a worktree rides the fast path and re-perspectives the window', async () => {
		const fixture = createRebindFixture();
		const { repo, mainPath, wtPath, mainTip, featureTip, otherTip, taggedSha } = fixture;
		try {
			const rowProcessor = new RestampTrackingRowProcessor();
			const session = await repo.provider.graph.openGraphSession(mainPath, { rowProcessor: rowProcessor });

			assert.strictEqual(session.repoPath, mainPath, 'the session opens bound to the main worktree');
			const priorShas = session.window.map(r => r.sha);
			assert.ok(priorShas.includes(featureTip), 'the feature-only commit is in the window (refs are shared)');
			assert.ok(
				session.current.reachableFromHEAD?.has(featureTip) !== true,
				'the feature-only commit is NOT reachable from main HEAD before the rebind',
			);
			for (const id of rowRefIds(session.window)) {
				assert.ok(id.startsWith(`${mainPath}|`), `ref id ${id} is stamped at the main worktree`);
			}

			repo.provider.cache.clearCaches(mainPath);
			const result = await session.rebind(wtPath);

			assert.strictEqual(
				result.path,
				'fast',
				`a plain rebind must ride the fast path (fallback reason: ${result.reason ?? 'none'})`,
			);
			assert.strictEqual(result.added, 0, 'a rebind enumerates no new commits');
			assert.strictEqual(session.repoPath, wtPath, 'the session is now bound to the worktree');

			// Row identity + order survive: this is a re-perspective, not a re-walk.
			assert.deepStrictEqual(
				session.window.map(r => r.sha),
				priorShas,
				'the window is unchanged in size/order',
			);

			// Top-level graph outputs come from the prelude at the NEW path.
			assert.strictEqual(session.current.repoPath, wtPath, 'the graph reports the new repoPath');
			const branches = session.current.branches;
			assert.strictEqual(branches.get('feature')?.id, `${wtPath}|heads/feature`);
			assert.strictEqual(branches.get('feature')?.current, true, 'feature is the current branch');
			assert.strictEqual(branches.get('main')?.id, `${wtPath}|heads/main`);
			assert.strictEqual(branches.get('main')?.current, false, 'main is no longer current');

			// The HEAD endpoints were refetched from the worktree's cwd, so `isCurrentHead` moved.
			let rowsBySha = new Map(session.window.map(r => [r.sha, r]));
			assert.strictEqual(
				rowsBySha.get(featureTip)?.heads?.find(h => h.name === 'feature')?.isCurrentHead,
				true,
				"feature's tip row carries the current-HEAD marker",
			);
			assert.strictEqual(
				rowsBySha.get(mainTip)?.heads?.find(h => h.name === 'main')?.isCurrentHead,
				false,
				"main's tip row no longer carries the current-HEAD marker",
			);
			assert.ok(
				session.current.reachableFromHEAD?.has(featureTip) === true,
				'the feature-only commit is reachable from the rebound HEAD',
			);

			// Reused (never-refetched) decorated rows were re-stamped in place.
			assert.strictEqual(
				rowsBySha.get(otherTip)?.heads?.find(h => h.name === 'other')?.id,
				`${wtPath}|heads/other`,
			);
			assert.strictEqual(rowsBySha.get(taggedSha)?.tags?.find(t => t.name === 'v1.0')?.id, `${wtPath}|tags/v1.0`);
			for (const id of rowRefIds(session.window)) {
				assert.ok(id.startsWith(`${wtPath}|`), `ref id ${id} is re-stamped at the worktree`);
			}

			// The re-stamp pass covers reused decorated rows only — rows the fast path rebuilt from raw git
			// at the new path are already correct and must not be processed twice.
			assert.ok(rowProcessor.restamped.has(otherTip), 'the reused `other` row went through restampRow');
			assert.ok(rowProcessor.restamped.has(taggedSha), 'the reused tagged row went through restampRow');
			assert.ok(!rowProcessor.restamped.has(featureTip), 'the refetched feature HEAD row was not re-stamped');
			assert.ok(!rowProcessor.restamped.has(mainTip), 'the refetched main HEAD row was not re-stamped');

			// Round-trip: rebinding home restores the mirror image.
			repo.provider.cache.clearCaches(wtPath);
			const back = await session.rebind(mainPath);

			assert.strictEqual(
				back.path,
				'fast',
				`the round-trip rebind must ride the fast path (fallback reason: ${back.reason ?? 'none'})`,
			);
			assert.strictEqual(session.repoPath, mainPath);
			assert.deepStrictEqual(
				session.window.map(r => r.sha),
				priorShas,
				'the window survived the round-trip',
			);
			assert.strictEqual(session.current.branches.get('main')?.current, true, 'main is current again');
			assert.strictEqual(session.current.branches.get('feature')?.current, false);

			rowsBySha = new Map(session.window.map(r => [r.sha, r]));
			assert.strictEqual(rowsBySha.get(mainTip)?.heads?.find(h => h.name === 'main')?.isCurrentHead, true);
			assert.strictEqual(rowsBySha.get(featureTip)?.heads?.find(h => h.name === 'feature')?.isCurrentHead, false);
			assert.ok(session.current.reachableFromHEAD?.has(mainTip) === true);
			assert.ok(
				session.current.reachableFromHEAD?.has(featureTip) !== true,
				'the feature-only commit is unreachable again',
			);
			assert.strictEqual(
				rowsBySha.get(otherTip)?.heads?.find(h => h.name === 'other')?.id,
				`${mainPath}|heads/other`,
			);
			for (const id of rowRefIds(session.window)) {
				assert.ok(id.startsWith(`${mainPath}|`), `ref id ${id} is re-stamped back at the main worktree`);
			}
		} finally {
			fixture.cleanup();
		}
	});

	test('a paged window survives a rebind (no re-shape to the default limit)', async () => {
		const fixture = createRebindFixture();
		const { repo, mainPath, wtPath } = fixture;
		try {
			const session = await repo.provider.graph.openGraphSession(mainPath, {
				rowProcessor: new FlagsRowProcessor(),
				limit: 5,
			});
			await session.more(5);
			const pagedShas = session.window.map(r => r.sha);
			assert.ok(pagedShas.length > 5, 'paged the window past the first page');

			repo.provider.cache.clearCaches(mainPath);
			const result = await session.rebind(wtPath);

			assert.strictEqual(
				result.path,
				'fast',
				`expected the fast path (fallback reason: ${result.reason ?? 'none'})`,
			);
			assert.deepStrictEqual(
				session.window.map(r => r.sha),
				pagedShas,
				'the rebind anchors on the accumulated window rather than the default limit',
			);
		} finally {
			fixture.cleanup();
		}
	});

	test('a genuine metadata change concurrent with a rebind still falls back to the full walk', async () => {
		// The rebind only excuses the fingerprint's `wd:` component (the perspective itself). Anything else
		// that moved must still rebuild every decoration — reused rows bake it in.
		const fixture = createRebindFixture();
		const { repo, mainPath, wtPath } = fixture;
		try {
			const session = await repo.provider.graph.openGraphSession(mainPath, {
				rowProcessor: new FlagsRowProcessor(),
			});

			// `+starred` is baked into pill contexts and moves no ref tip.
			setBranchGkDisposition(mainPath, 'main', 'starred');
			repo.provider.cache.clearCaches(mainPath);
			const result = await session.rebind(wtPath);

			assert.strictEqual(result.path, 'full', 'a real metadata change must not ride the rebind fast path');
			assert.strictEqual(result.reason, 'metadata-changed');
			assert.strictEqual(session.repoPath, wtPath, 'the rebind still applied — just via a full walk');
			assert.strictEqual(session.current.branches.get('feature')?.current, true);
		} finally {
			fixture.cleanup();
		}
	});

	/**
	 * The real-world shape: a CLONE where `main` tracks `origin/main` and the worktree's `feature` tracks
	 * `origin/feature`, each one unpushed commit ahead. HEAD's upstream is a decoration-fingerprint input, so
	 * without the seed carrying the prior HEAD upstream this rebind would look like a metadata change and
	 * re-walk — which, in a cloned repo, would be every rebind.
	 */
	function createUpstreamRebindFixture() {
		const origin = createTestRepo();
		try {
			addEmptyCommits(origin.path, 5, 'o');
			const clone = cloneTestRepo(origin.path);
			try {
				// `feature` forks at (and is pushed to) the same commit `origin/main` sits on, so ONE reused row
				// carries both remote pills — exactly the row whose `current` marker has to move.
				createBranch(clone.path, 'feature');
				push(clone.path, 'origin', 'feature');
				setUpstream(clone.path, 'feature', 'origin/feature');
				addCommit(clone.path, 'm.txt', 'm', 'Main-only unpushed commit');
				const worktree = createWorktree(clone.path, 'feature');
				try {
					addCommit(worktree.path, 'f.txt', 'f', 'Feature-only unpushed commit');
				} catch (ex) {
					worktree.cleanup();
					throw ex;
				}

				return {
					clone: clone,
					mainPath: clone.path,
					wtPath: worktree.path,
					sharedTip: revParse(clone.path, 'origin/main'),
					mainOnly: revParse(clone.path, 'main'),
					featureOnly: revParse(worktree.path, 'HEAD'),
					cleanup: () => {
						worktree.cleanup();
						clone.cleanup();
						origin.cleanup();
					},
				};
			} catch (ex) {
				clone.cleanup();
				throw ex;
			}
		} catch (ex) {
			origin.cleanup();
			throw ex;
		}
	}

	/** Whether the row for `sha` is flagged ahead of HEAD's upstream. */
	function isUnpublished(session: GitGraphSession, sha: string): boolean {
		const row = session.window.find(r => r.sha === sha);
		assert.ok(row != null, `row ${sha} is in the window`);
		return ((row.contexts?.flags ?? 0) & GitGraphRowContextFlags.Unpublished) !== 0;
	}

	/** The `current` marker on the row's remote pill for `origin/<name>` — HEAD's tracking upstream tip. */
	function remoteCurrent(session: GitGraphSession, sha: string, name: string): boolean | undefined {
		const row = session.window.find(r => r.sha === sha);
		assert.ok(row != null, `row ${sha} is in the window`);
		const remote = row.remotes?.find(r => r.owner === 'origin' && r.name === name);
		assert.ok(remote != null, `row ${sha} carries an origin/${name} pill`);
		return remote.current;
	}

	test('rebinding between worktrees with DIFFERENT upstreams stays on the fast path', async () => {
		const fixture = createUpstreamRebindFixture();
		const { clone, mainPath, wtPath, sharedTip, mainOnly, featureOnly } = fixture;
		try {
			const session = await clone.provider.graph.openGraphSession(mainPath, {
				rowProcessor: new FlagsRowProcessor(),
			});

			// Baseline: HEAD is `main`, tracking `origin/main`.
			assert.strictEqual(remoteCurrent(session, sharedTip, 'main'), true);
			assert.strictEqual(remoteCurrent(session, sharedTip, 'feature'), false);
			assert.strictEqual(
				isUnpublished(session, mainOnly),
				true,
				"main's unpushed commit is ahead of origin/main",
			);
			assert.strictEqual(isUnpublished(session, featureOnly), false, 'a commit off HEAD is never unpublished');

			clone.provider.cache.clearCaches(mainPath);
			const result = await session.rebind(wtPath);

			assert.strictEqual(
				result.path,
				'fast',
				`a rebind onto a differently-tracked branch must stay fast (fallback reason: ${result.reason ?? 'none'})`,
			);

			// The upstream marker moved between the two pills on the SAME reused row.
			assert.strictEqual(
				remoteCurrent(session, sharedTip, 'feature'),
				true,
				"origin/feature is now HEAD's upstream",
			);
			assert.strictEqual(remoteCurrent(session, sharedTip, 'main'), false, 'origin/main no longer is');
			assert.strictEqual(
				isUnpublished(session, featureOnly),
				true,
				'the feature-only commit is ahead of origin/feature',
			);
			assert.strictEqual(
				isUnpublished(session, mainOnly),
				false,
				"main's unpushed commit is off the rebound HEAD, so it is not marked",
			);
			assert.ok(session.current.reachableFromHEAD?.has(featureOnly) === true);
			assert.ok(session.current.reachableFromHEAD?.has(mainOnly) !== true);

			// Round-trip restores the original perspective.
			clone.provider.cache.clearCaches(wtPath);
			const back = await session.rebind(mainPath);

			assert.strictEqual(
				back.path,
				'fast',
				`the round-trip must stay fast (fallback reason: ${back.reason ?? 'none'})`,
			);
			assert.strictEqual(remoteCurrent(session, sharedTip, 'main'), true);
			assert.strictEqual(remoteCurrent(session, sharedTip, 'feature'), false);
			assert.strictEqual(isUnpublished(session, mainOnly), true);
			assert.strictEqual(isUnpublished(session, featureOnly), false);
		} finally {
			fixture.cleanup();
		}
	});

	test("neutralizing HEAD's upstream does not disarm the rest of the metadata gate", async () => {
		// Same cloned shape as above (where `h:` IS being neutralized) — a real decoration change must still
		// force the full walk that rebuilds every pill.
		const fixture = createUpstreamRebindFixture();
		const { clone, mainPath, wtPath } = fixture;
		try {
			const session = await clone.provider.graph.openGraphSession(mainPath, {
				rowProcessor: new FlagsRowProcessor(),
			});

			setBranchGkDisposition(mainPath, 'feature', 'starred');
			clone.provider.cache.clearCaches(mainPath);
			const result = await session.rebind(wtPath);

			assert.strictEqual(result.path, 'full', 'a real metadata change must not ride the rebind fast path');
			assert.strictEqual(result.reason, 'metadata-changed');
			assert.strictEqual(session.repoPath, wtPath, 'the rebind still applied — just via a full walk');
		} finally {
			fixture.cleanup();
		}
	});

	test('a checkout in the DEFAULT worktree concurrent with a rebind away from it falls back', async () => {
		// `wd:` (the default worktree's checkout) is absent from the fingerprint on BOTH sides of a
		// default→secondary rebind, so this change is invisible to the comparison — the gate has to catch it
		// by comparing the seed's own current-head name against the default worktree's fresh branch.
		// Otherwise the newly-checked-out branch's tip row would be reused with a stale `worktree` ref.
		const fixture = createRebindFixture();
		const { repo, mainPath, wtPath, otherTip } = fixture;
		try {
			const session = await repo.provider.graph.openGraphSession(mainPath, {
				rowProcessor: new FlagsRowProcessor(),
			});
			const otherRow = session.window.find(r => r.sha === otherTip);
			assert.strictEqual(
				otherRow?.heads?.find(h => h.name === 'other')?.worktree,
				undefined,
				'`other` is not checked out anywhere yet',
			);

			checkout(mainPath, 'other');
			repo.provider.cache.clearCaches(mainPath);
			const result = await session.rebind(wtPath);

			assert.strictEqual(result.path, 'full', 'the default worktree moved — reused rows must be rebuilt');
			assert.strictEqual(result.reason, 'metadata-changed');
			assert.strictEqual(session.repoPath, wtPath);
			// The full walk rebuilt it: `other` now carries the default worktree.
			const rebuilt = session.window.find(r => r.sha === otherTip);
			assert.strictEqual(
				rebuilt?.heads?.find(h => h.name === 'other')?.worktree?.isDefault,
				true,
				"`other` is now the default worktree's checkout",
			);
		} finally {
			fixture.cleanup();
		}
	});

	/** The stash row's serialized context, parsed. `contexts.row` is `string | object`; the processors here
	 *  always serialize, so anything else is a test failure. */
	function parseStashContext(session: GitGraphSession, sha: string): unknown {
		const context = session.window.find(r => r.sha === sha)?.contexts?.row;
		if (typeof context !== 'string') {
			assert.fail(`row ${sha} carries a serialized stash context`);
		}

		return JSON.parse(context);
	}

	test('a stash-bearing window rebinds on the fast path, re-stamping the stash context', async () => {
		const repo = createTestRepo();
		let worktree: { path: string; cleanup: () => void } | undefined;
		try {
			addEmptyCommits(repo.path, 5, 's');
			createBranch(repo.path, 'feature');
			worktree = createWorktree(repo.path, 'feature');
			addCommit(worktree.path, 'f.txt', 'f', 'Feature-only commit');
			// Stashes live on the SHARED `refs/stash`, so both perspectives see the same stack.
			createStash(repo.path, 'wip');

			const wtPath = worktree.path;
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new StashContextRowProcessor(),
			});
			const priorShas = session.window.map(r => r.sha);
			const stashSha = session.window.find(r => r.kind === 'stash')?.sha;
			assert.ok(stashSha != null, 'the stash row is in the window');
			assert.deepStrictEqual(parseStashContext(session, stashSha), {
				type: 'stash',
				repoPath: repo.path,
				sha: stashSha,
			});

			repo.provider.cache.clearCaches(repo.path);
			const result = await session.rebind(wtPath);

			assert.strictEqual(
				result.path,
				'fast',
				`a stash in the window must not force a re-walk (fallback reason: ${result.reason ?? 'none'})`,
			);
			assert.deepStrictEqual(
				session.window.map(r => r.sha),
				priorShas,
				'the window survived intact',
			);
			const stashRow = session.window.find(r => r.sha === stashSha);
			assert.strictEqual(stashRow?.kind, 'stash', 'the stash row survived as a stash row');
			assert.deepStrictEqual(
				parseStashContext(session, stashSha),
				{ type: 'stash', repoPath: wtPath, sha: stashSha },
				'the serialized stash context was rebuilt at the new path',
			);
		} finally {
			worktree?.cleanup();
			repo.cleanup();
		}
	});

	test('a rebind whose walk fails reverts the binding and forces the next refresh to walk fully', async () => {
		const fixture = createRebindFixture();
		const { repo, mainPath, wtPath, otherTip } = fixture;
		try {
			const rowProcessor = new ExplodingRowProcessor();
			const session = await repo.provider.graph.openGraphSession(mainPath, { rowProcessor: rowProcessor });
			const priorShas = session.window.map(r => r.sha);

			// Both the fast path AND the full walk it degrades to now throw, so the rebind can't complete.
			rowProcessor.armed = true;
			repo.provider.cache.clearCaches(mainPath);
			await assert.rejects(() => session.rebind(wtPath), 'the rebind surfaces the walk failure');

			assert.strictEqual(session.repoPath, mainPath, 'the binding reverted to the path the window describes');
			// The window really is corrupt: the re-stamp landed on the rows walked before the throw.
			assert.strictEqual(
				session.window.find(r => r.sha === otherTip)?.heads?.find(h => h.name === 'other')?.id,
				`${wtPath}|heads/other`,
				'a reused row was re-stamped in place before the failure',
			);

			// The window may have been mutated in place before the throw, so the next refresh must NOT be
			// seeded from it — it has to walk fully and rebuild every row.
			rowProcessor.armed = false;
			repo.provider.cache.clearCaches(mainPath);
			const result = await session.refresh();

			assert.strictEqual(result.path, 'full', 'the failed rebind dropped the incremental seed');
			assert.strictEqual(result.reason, undefined, 'an unseeded full walk carries no fallback reason');
			assert.deepStrictEqual(
				session.window.map(r => r.sha),
				priorShas,
				'the rebuilt window matches',
			);
			assert.strictEqual(
				session.window.find(r => r.sha === otherTip)?.heads?.find(h => h.name === 'other')?.id,
				`${mainPath}|heads/other`,
				'every ref id is stamped at the bound path again',
			);
		} finally {
			fixture.cleanup();
		}
	});

	test('rebinding to the already-bound path is a no-op', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 5, 's');
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
			});
			const priorGraph = session.current;

			const result = await session.rebind(repo.path);

			assert.strictEqual(result.path, 'fast');
			assert.strictEqual(result.added, 0);
			assert.deepStrictEqual(result.changed, {
				rows: false,
				reachability: false,
				rowsStats: false,
				avatars: false,
				downstreams: false,
			});
			assert.strictEqual(session.repoPath, repo.path);
			assert.strictEqual(session.current, priorGraph, 'no walk ran — the graph is untouched');
		} finally {
			repo.cleanup();
		}
	});
});
