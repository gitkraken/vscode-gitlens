import * as assert from 'assert';
import { rmSync } from 'node:fs';
import type {
	GitGraph,
	GitGraphRow,
	GraphContext,
	GraphIncrementalSeed,
	IncrementalGraphOutcome,
} from '@gitlens/git/models/graph.js';
import { assertGraphEquivalence, assertGraphsEquivalent, FlagsRowProcessor } from './graphEquivalence.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	addCommits,
	addEmptyCommits,
	addWorktree,
	amendHead,
	checkout,
	cloneTestRepo,
	createBranch,
	createBranchAt,
	createReplaceRef,
	createStash,
	createTag,
	createTestRepo,
	createTrackingBranch,
	deleteBranch,
	deleteTag,
	fetch,
	getRefTips,
	getRootSha,
	mergeBranch,
	push,
	rebaseCurrentOnto,
	revParse,
	setBranchGkDisposition,
	setConfig,
	setRemoteHead,
	setUpstream,
	stashPop,
	unshallow,
} from './helpers.js';

/**
 * Seeds a non-trivial DAG: two commits on main, a two-commit feature branch merged back with a real
 * merge commit, then a tag — so scenarios exercise merges (two-parent reachability propagation), several
 * heads, and a tag ref.
 */
function seedBaseHistory(path: string): void {
	addCommit(path, 'a.txt', 'a', 'A');
	addCommit(path, 'b.txt', 'b', 'B');
	createBranch(path, 'feature', { checkout: true });
	addCommit(path, 'f1.txt', 'f1', 'F1');
	addCommit(path, 'f2.txt', 'f2', 'F2');
	checkout(path, 'main');
	addCommit(path, 'c.txt', 'c', 'C');
	mergeBranch(path, 'feature', 'Merge feature into main');
	createTag(path, 'v1.0');
}

// R6b's fast path is byte-equivalence-gated: every scenario asserts BOTH that the seeded walk equals a
// full walk of the mutated repo AND that it took the expected path ('fast' or 'fallback' + reason). The
// suite spans the high-frequency events the fast path targets plus every structural fallback trigger.
suite('graph incremental head-walk equivalence (R6b)', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
		seedBaseHistory(repo.path);
	});

	teardown(() => {
		repo.cleanup();
	});

	// Fast-path (high-frequency) events.

	test('commit at head', async () => {
		await assertGraphEquivalence(repo, p => addCommit(p, 'new.txt', 'n', 'New commit at head'), { path: 'fast' });
	});

	test('multi-commit batch at head', async () => {
		await assertGraphEquivalence(repo, p => addCommits(p, 5), { path: 'fast' });
	});

	test('fetch batch advances a remote-tracking ref', async () => {
		const origin = createTestRepo();
		seedBaseHistory(origin.path);
		const clone = cloneTestRepo(origin.path);
		try {
			// A local commit ahead of origin/main so its row carries the Unpublished flag (exercises that bit).
			addCommit(clone.path, 'local.txt', 'local', 'Local ahead of upstream');
			clone.provider.cache.clearCaches(clone.path);

			await assertGraphEquivalence(
				clone,
				() => {
					addCommits(origin.path, 3, 'remote');
					fetch(clone.path);
				},
				{ path: 'fast' },
			);
		} finally {
			clone.cleanup();
			origin.cleanup();
		}
	});

	test('branch create at head', async () => {
		await assertGraphEquivalence(repo, p => createBranch(p, 'newbranch'), { path: 'fast' });
	});

	test('branch create + checkout (HEAD moves to new tip)', async () => {
		await assertGraphEquivalence(repo, p => createBranch(p, 'newbranch', { checkout: true }), { path: 'fast' });
	});

	test('checkout moves HEAD to an existing branch', async () => {
		// feature is an ancestor of main; checking it out shrinks reachable/rewriteable-from-HEAD.
		await assertGraphEquivalence(repo, p => checkout(p, 'feature'), { path: 'fast' });
	});

	test('tag add', async () => {
		await assertGraphEquivalence(repo, p => createTag(p, 'v2.0'), { path: 'fast' });
	});

	// Fast-path with retained-row re-derivation (new scenarios).

	test('branch create at an INTERIOR sha flips +unique on a retained row', async () => {
		// C (main~1) is reachable from `main` only → `+unique`; a branch at C makes it 2 local branches, so
		// its `+unique` flag clears AND its reachable-set membership re-interns. Exercises retained-row correctness.
		await assertGraphEquivalence(repo, p => createBranchAt(p, 'atC', 'main~1'), { path: 'fast' });
	});

	test('checkout -b at an INTERIOR sha (HEAD moves down + new branch there)', async () => {
		// HEAD moves from the merge tip down to C, shrinking reachable/rewriteable-from-HEAD, and a new branch
		// lands on the (retained) C row.
		await assertGraphEquivalence(repo, p => createBranchAt(p, 'interior', 'main~1', { checkout: true }), {
			path: 'fast',
		});
	});

	test('checkout to another branch at the SAME commit moves isCurrentHead on a retained row', async () => {
		// Two branches sit on the identical commit (the merge tip); checking out the other moves no branch sha,
		// so only the current-head ref NAME changes. The gate must still re-derive that row — without the name
		// comparison the retained row keeps a stale `isCurrentHead` pill. The twin branch must exist BEFORE the
		// seed walk: a mutation-time branch-create would re-derive the row via the new-ref gate and mask the bug.
		createBranch(repo.path, 'twin'); // at main's HEAD (the merge tip), not checked out
		await assertGraphEquivalence(repo, p => checkout(p, 'twin'), { path: 'fast' });
	});

	test('fetch that publishes a local commit clears its Unpublished flag on a retained row', async () => {
		const origin = createTestRepo();
		seedBaseHistory(origin.path);
		// origin has main checked out (non-bare); allow pushing into it (its work tree goes stale, but we only
		// fetch refs from it).
		setConfig(origin.path, 'receive.denyCurrentBranch', 'ignore');
		const clone = cloneTestRepo(origin.path);
		try {
			// Local commit L on top of origin/main → L is Unpublished in the seed.
			addCommit(clone.path, 'local.txt', 'local', 'Local ahead of upstream');
			clone.provider.cache.clearCaches(clone.path);

			// Push L to origin, then fetch: origin/main advances to L (fast-forward), so L becomes reachable
			// from the upstream tip → its Unpublished flag must clear on the retained L row.
			await assertGraphEquivalence(
				clone,
				p => {
					push(p, 'origin', 'main');
					fetch(p);
				},
				{ path: 'fast' },
			);
		} finally {
			clone.cleanup();
			origin.cleanup();
		}
	});

	test('replace ref present + unchanged in both walks → still fast', async () => {
		// A replacement built BEFORE the seed walk (so the seed rows are traversed under the same replaced
		// ancestry as the mutated walk) that does NOT change between generations must NOT trip the replace gate —
		// a plain head commit still takes the fast path. Uses a fresh linear repo so the replaced parent link is
		// unambiguous. Note: git log traverses WITH the active replacement on every walk here, so the seed tail
		// and the full walk's tail are built from the identical replaced graph → row parity holds.
		const r = createTestRepo();
		try {
			addEmptyCommits(r.path, 10, 's');
			// Replace an interior commit with its own grandparent (an ancestor → no cycle), collapsing that link.
			createReplaceRef(r.path, revParse(r.path, 'HEAD~3'), revParse(r.path, 'HEAD~5'));
			r.provider.cache.clearCaches(r.path);

			await assertGraphEquivalence(r, p => addCommit(p, 'new.txt', 'n', 'New head commit'), { path: 'fast' });
		} finally {
			r.cleanup();
		}
	});

	// Structural fallback triggers (fast path degrades to the full walk).

	test('replace ref added rewrites ancestry presentation (full fallback)', async () => {
		// Creating a `refs/replace/*` ref moves no branch tip yet rewrites how ancestry is presented globally —
		// the cached rows' parent links are stale, so the fast path must fall back. The full walks on both sides
		// traverse the replaced graph identically → byte-equivalent.
		await assertGraphEquivalence(repo, p => createReplaceRef(p, revParse(p, 'main~1'), revParse(p, 'main~2')), {
			path: 'fallback',
			reason: 'replace-refs-changed',
		});
	});

	// Decoration-metadata fallbacks: side inputs row construction EMBEDS into row decorations change while
	// no ref tip moves — the fingerprint gate must force the full walk that rebuilds them (reused rows
	// would otherwise keep stale upstream/default/worktree pills indefinitely).

	test('remote HEAD retarget (default-branch change) rebuilds decorations (full fallback)', async () => {
		const origin = createTestRepo();
		seedBaseHistory(origin.path);
		const clone = cloneTestRepo(origin.path);
		try {
			// `git remote set-head` moves no tip, but flips which remote head carries the default marker.
			await assertGraphEquivalence(clone, p => setRemoteHead(p, 'origin', 'feature'), {
				path: 'fallback',
				reason: 'metadata-changed',
			});
		} finally {
			clone.cleanup();
			origin.cleanup();
		}
	});

	test('upstream retarget on the current branch rebuilds decorations (full fallback)', async () => {
		const origin = createTestRepo();
		seedBaseHistory(origin.path);
		const clone = cloneTestRepo(origin.path);
		try {
			// `--set-upstream-to` moves no tip, but moves the upstream `current` marker between retained
			// remote-head rows AND re-derives Unpublished against the new upstream tip.
			await assertGraphEquivalence(clone, p => setUpstream(p, 'main', 'origin/feature'), {
				path: 'fallback',
				reason: 'metadata-changed',
			});
		} finally {
			clone.cleanup();
			origin.cleanup();
		}
	});

	test('checkout to a branch with a DIFFERENT upstream rebuilds decorations (full fallback)', async () => {
		const origin = createTestRepo();
		seedBaseHistory(origin.path);
		const clone = cloneTestRepo(origin.path);
		try {
			// The branch must exist BEFORE the seed walk (a mutation-time create would trip the new-ref
			// gate and mask this): the checkout moves HEAD's upstream from origin/main to origin/feature,
			// so the upstream `current` marker + Unpublished derivation move while no tip does.
			createTrackingBranch(clone.path, 'other', 'origin/feature');
			clone.provider.cache.clearCaches(clone.path);
			await assertGraphEquivalence(clone, p => checkout(p, 'other'), {
				path: 'fallback',
				reason: 'metadata-changed',
			});
		} finally {
			clone.cleanup();
			origin.cleanup();
		}
	});

	test('upstream-only fetch refetches the tracking branch row (fast path, fresh +ahead/+behind)', async () => {
		// A fetch that advances ONLY origin/main leaves local main's tip put — but `+behind` is baked into
		// that pill's serialized context, so the fast path must REFETCH the local row (not reuse it, not
		// fall back). Asserted via a recording processor: the local tip is re-processed on the seeded walk.
		class RecordingProcessor extends FlagsRowProcessor {
			readonly processed = new Set<string>();
			override processRow(row: GitGraphRow, context: GraphContext): void {
				this.processed.add(row.sha);
				super.processRow(row, context);
			}
		}

		const origin = createTestRepo();
		seedBaseHistory(origin.path);
		const clone = cloneTestRepo(origin.path);
		try {
			const { provider, path: repoPath } = clone;
			const localMainSha = revParse(repoPath, 'main');
			const pre = await provider.graph.getGraph(repoPath, undefined, {
				include: { stats: false },
				rowProcessor: new FlagsRowProcessor(),
			});
			const seed: GraphIncrementalSeed = {
				rows: pre.rows,
				tips: getRefTips(repoPath),
				ordering: 'date',
				reachability: pre.reachability,
				rowsStats: pre.rowsStats,
				hasMore: pre.paging?.hasMore,
				onlyFollowFirstParent: false,
				shallow: pre.shallow,
				decorationFingerprint: pre.decorationFingerprint,
			};

			addCommits(origin.path, 2, 'remote');
			fetch(repoPath);
			provider.cache.clearCaches(repoPath);

			const expected = await provider.graph.getGraph(repoPath, undefined, {
				include: { stats: false },
				rowProcessor: new FlagsRowProcessor(),
			});
			const recorder = new RecordingProcessor();
			let outcome: IncrementalGraphOutcome | undefined;
			const actual = await provider.graph.getGraph(repoPath, undefined, {
				include: { stats: false },
				rowProcessor: recorder,
				incrementalSeed: seed,
				reachabilitySeed: pre.reachability,
				rowsStatsSeed: pre.rowsStats,
				onIncrementalResult: o => {
					outcome = o;
				},
			});

			assert.strictEqual(outcome?.path, 'fast', 'an upstream-only fetch must stay on the fast path');
			assert.ok(
				recorder.processed.has(localMainSha),
				'the tracking branch row must be refetched (its +behind context went stale)',
			);
			assertGraphsEquivalent(expected, actual, { includeStats: false });
		} finally {
			clone.cleanup();
			origin.cleanup();
		}
	});

	test('starring a branch rebuilds decorations (full fallback)', async () => {
		// `+starred` is baked into pill contexts; a disposition change moves no ref tip.
		await assertGraphEquivalence(repo, p => setBranchGkDisposition(p, 'main', 'starred'), {
			path: 'fallback',
			reason: 'metadata-changed',
		});
	});

	test('main-worktree checkout busts the fingerprint for a SECONDARY-worktree graph (full fallback)', async () => {
		// From a secondary worktree's viewpoint, a checkout in the MAIN worktree flips `+checkedout` / the
		// main-path worktree recovery while moving no tip and no local HEAD — only the fingerprint's `wd:`
		// component (present only off the default worktree) can catch it.
		const worktreePath = `${repo.path}-wt2`;
		createBranch(repo.path, 'other'); // the main checkout's target; exists BEFORE the seed walk
		addWorktree(repo.path, worktreePath, 'feature');
		try {
			const { provider } = repo;
			const pre = await provider.graph.getGraph(worktreePath, undefined, {
				include: { stats: false },
				rowProcessor: new FlagsRowProcessor(),
			});
			const seed: GraphIncrementalSeed = {
				rows: pre.rows,
				tips: getRefTips(worktreePath),
				ordering: 'date',
				reachability: pre.reachability,
				rowsStats: pre.rowsStats,
				hasMore: pre.paging?.hasMore,
				onlyFollowFirstParent: false,
				shallow: pre.shallow,
				decorationFingerprint: pre.decorationFingerprint,
			};

			checkout(repo.path, 'other'); // MAIN worktree checkout; the secondary's HEAD is untouched
			provider.cache.clearCaches(worktreePath);
			provider.cache.clearCaches(repo.path);

			const expected = await provider.graph.getGraph(worktreePath, undefined, {
				include: { stats: false },
				rowProcessor: new FlagsRowProcessor(),
			});
			let outcome: IncrementalGraphOutcome | undefined;
			const actual = await provider.graph.getGraph(worktreePath, undefined, {
				include: { stats: false },
				rowProcessor: new FlagsRowProcessor(),
				incrementalSeed: seed,
				reachabilitySeed: pre.reachability,
				rowsStatsSeed: pre.rowsStats,
				onIncrementalResult: o => {
					outcome = o;
				},
			});

			assert.strictEqual(outcome?.path, 'fallback', 'a main-worktree checkout must fall back off-worktree');
			assert.strictEqual(outcome?.reason, 'metadata-changed');
			assertGraphsEquivalent(expected, actual, { includeStats: false });
		} finally {
			rmSync(worktreePath, { recursive: true, force: true });
		}
	});

	test('worktree add on a loaded branch rebuilds decorations (full fallback)', async () => {
		// `git worktree add` moves no tip, but the feature row must gain its worktree marker.
		const worktreePath = `${repo.path}-wt`;
		try {
			await assertGraphEquivalence(repo, p => addWorktree(p, worktreePath, 'feature'), {
				path: 'fallback',
				reason: 'metadata-changed',
			});
		} finally {
			rmSync(worktreePath, { recursive: true, force: true });
		}
	});

	test('fast-path failure AFTER its mutation barrier still yields a byte-identical full walk', async () => {
		// A processor that throws the FIRST time it sees the new commit — inside the fast path's
		// commit-and-mutate loop, AFTER `ids`/`total` were populated — then succeeds (the fallback full
		// walk re-processes every row). Without the catch-side accumulator reset, the full walk's
		// `ids.has` dedup would silently DROP the already-registered rows.
		class OneShotThrowingProcessor extends FlagsRowProcessor {
			private thrown = false;
			override processRow(row: GitGraphRow, context: GraphContext): void {
				if (!this.thrown && row.message === 'Injected failure target') {
					this.thrown = true;
					throw new Error('injected row-processor failure');
				}

				super.processRow(row, context);
			}
		}

		const { provider, path: repoPath } = repo;
		const processor = new OneShotThrowingProcessor();
		const pre = await provider.graph.getGraph(repoPath, undefined, {
			include: { stats: false },
			rowProcessor: processor,
		});
		const seed: GraphIncrementalSeed = {
			rows: pre.rows,
			tips: getRefTips(repoPath),
			ordering: 'date',
			reachability: pre.reachability,
			rowsStats: pre.rowsStats,
			hasMore: pre.paging?.hasMore,
			onlyFollowFirstParent: false,
			shallow: pre.shallow,
			decorationFingerprint: pre.decorationFingerprint,
		};

		addCommit(repoPath, 'boom.txt', 'x', 'Injected failure target');
		provider.cache.clearCaches(repoPath);

		const expected = await provider.graph.getGraph(repoPath, undefined, {
			include: { stats: false },
			rowProcessor: new FlagsRowProcessor(),
		});

		let outcome: IncrementalGraphOutcome | undefined;
		const actual = await provider.graph.getGraph(repoPath, undefined, {
			include: { stats: false },
			rowProcessor: processor,
			incrementalSeed: seed,
			reachabilitySeed: pre.reachability,
			rowsStatsSeed: pre.rowsStats,
			onIncrementalResult: o => {
				outcome = o;
			},
		});

		assert.strictEqual(outcome?.path, 'fallback', 'expected the injected failure to force a fallback');
		assert.strictEqual(outcome?.reason, 'error', 'expected the error fallback reason');
		assertGraphsEquivalent(expected, actual, { includeStats: false });
	});

	test('unshallow deepens history below the window (full fallback)', async () => {
		// A shallow clone whose branch tips DON'T move on `--unshallow`: without the shallow gate the fast path
		// would enumerate zero new commits and report a stale-false `hasMore`, hiding the newly deepened history.
		// The gate forces a full walk; both full walks see the same (now-complete) history → byte-equivalent.
		// Stats ARE asserted: a shallow-boundary commit's true diff changes once its parent is fetched, so the
		// fallback walk drops the `rowsStatsSeed` for parent-rewriting reasons and recomputes — this scenario is
		// the regression test for that (a carried-forward seed would show the stale whole-tree stat and fail here).
		const origin = createTestRepo();
		seedBaseHistory(origin.path);
		addCommits(origin.path, 5, 'deep'); // extra depth so `--unshallow` genuinely fills in history
		const clone = cloneTestRepo(origin.path, { depth: 1 });
		try {
			clone.provider.cache.clearCaches(clone.path);
			await assertGraphEquivalence(clone, p => unshallow(p), { path: 'fallback', reason: 'shallow-changed' });
		} finally {
			clone.cleanup();
			origin.cleanup();
		}
	});

	test('branch delete', async () => {
		// feature is merged, so its commits stay reachable via the merge — only the ref (row head) disappears.
		await assertGraphEquivalence(repo, p => deleteBranch(p, 'feature'), {
			path: 'fallback',
			reason: 'ref-deleted',
		});
	});

	test('tag delete', async () => {
		await assertGraphEquivalence(repo, p => deleteTag(p, 'v1.0'), { path: 'fallback', reason: 'ref-deleted' });
	});

	test('amend rewrites HEAD sha', async () => {
		await assertGraphEquivalence(repo, p => amendHead(p, 'Amended merge message'), {
			path: 'fallback',
			reason: 'ref-non-fast-forward',
		});
	});

	test('rebase rewrites diverged shas (non-fast-forward move)', async () => {
		// topic diverges from main, main advances, then topic is rebased onto main → topic's sha changes.
		createBranch(repo.path, 'topic', { checkout: true });
		addCommit(repo.path, 'topic.txt', 't', 'Topic work');
		checkout(repo.path, 'main');
		addCommit(repo.path, 'main2.txt', 'm', 'Main advance');
		checkout(repo.path, 'topic');
		repo.provider.cache.clearCaches(repo.path);

		await assertGraphEquivalence(repo, p => rebaseCurrentOnto(p, 'main'), {
			path: 'fallback',
			reason: 'ref-non-fast-forward',
		});
	});

	test('stash push adds a stash row', async () => {
		await assertGraphEquivalence(repo, p => createStash(p, 'work in progress'), {
			path: 'fallback',
			reason: 'stash-changed',
		});
	});

	test('stash pop removes a stash row', async () => {
		createStash(repo.path, 'to pop');
		repo.provider.cache.clearCaches(repo.path, 'stashes');

		await assertGraphEquivalence(repo, p => stashPop(p), { path: 'fallback', reason: 'stash-changed' });
	});

	test('old-dated new commit interleaves by date order', async () => {
		// A new tip forked off the root with a date OLDER than recent history sorts into the MIDDLE under
		// --date-order (not at the head) — the date-interleave fallback hazard.
		const root = getRootSha(repo.path);
		await assertGraphEquivalence(
			repo,
			p => {
				createBranchAt(p, 'backdated', root, { checkout: true });
				// Dated between the initial commit (2024-01-01) and the monotonic-clock history (2024-06-01+),
				// so under --date-order it interleaves into the MIDDLE, not above the seam.
				addCommit(p, 'old.txt', 'old', 'Backdated commit', { date: '2024-02-01T00:00:00Z' });
				checkout(p, 'main');
			},
			{ path: 'fallback', reason: 'date-boundary' },
		);
	});
});

// Paging + limit-trim: the fast path must produce a window (and a `more()` continuation) byte-identical
// to a full walk at the SAME limit, including rows pushed out by new commits. These need explicit limits, so
// they drive getGraph directly rather than via `assertGraphEquivalence`.
suite('graph incremental head-walk paging + limit-trim (R6b)', () => {
	/** Builds a seed from a (possibly multi-page) set of loaded rows + the graph's accumulated artifacts. */
	function makeSeed(repoPath: string, rows: readonly GitGraphRow[], graph: GitGraph): GraphIncrementalSeed {
		return {
			rows: rows,
			tips: getRefTips(repoPath),
			ordering: 'date',
			reachability: graph.reachability,
			rowsStats: graph.rowsStats,
			hasMore: graph.paging?.hasMore,
			onlyFollowFirstParent: false,
			shallow: graph.shallow,
			decorationFingerprint: graph.decorationFingerprint,
		};
	}

	test('paged seed + commit: window AND the next more() page match a full walk at limit=ids.size', async () => {
		const repo = createTestRepo();
		try {
			// A few hundred linear (empty) commits — enough to page across a limit boundary.
			addEmptyCommits(repo.path, 299, 'p');
			const rp = new FlagsRowProcessor();

			// Fully page the prior generation: first 200, then the rest — the seed carries ALL loaded rows.
			const g0 = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: false },
				rowProcessor: rp,
				limit: 200,
			});
			assert.strictEqual(g0.paging?.hasMore, true, 'g0 should have more');
			const g1 = await g0.more!(200);
			assert.ok(g1 != null);
			const loaded = [...g0.rows, ...g1.rows];
			const priorSize = loaded.length; // = total history (fully paged)
			assert.strictEqual(g1.paging?.hasMore, false, 'g1 should be fully loaded');

			const seed = makeSeed(repo.path, loaded, g1);

			// Mutate: one new commit at head.
			addCommit(repo.path, 'top.txt', 'top', 'New head commit');
			repo.provider.cache.clearCaches(repo.path);

			// EXPECTED: full walk at limit=priorSize (new commit pushes the bottom row out) + its more() page.
			const expected = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: false },
				rowProcessor: rp,
				limit: priorSize,
			});

			// ACTUAL: seeded fast path at the same limit.
			let outcome: IncrementalGraphOutcome | undefined;
			const actual = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: false },
				rowProcessor: rp,
				limit: priorSize,
				incrementalSeed: seed,
				reachabilitySeed: seed.reachability,
				onIncrementalResult: o => {
					outcome = o;
				},
			});

			assert.strictEqual(outcome?.path, 'fast', 'expected the fast path');
			assert.strictEqual(actual.rows.length, priorSize, 'trimmed to the requested limit');
			assert.strictEqual(actual.paging?.hasMore, true, 'a row was pushed out → hasMore');
			assertGraphsEquivalent(expected, actual, { includeStats: false });

			// The next more() page from the fast-path graph must equal the full-walk graph's more() page.
			const expectedNext = await expected.more!(priorSize);
			const actualNext = await actual.more!(priorSize);
			assert.ok(expectedNext != null && actualNext != null);
			assertGraphsEquivalent(expectedNext, actualNext, { includeStats: false });
		} finally {
			repo.cleanup();
		}
	});

	test('limit-trim: new commits push bottom rows out, matching a full walk at the same limit', async () => {
		const repo = createTestRepo();
		try {
			addCommits(repo.path, 49, 'p'); // 50 commits total
			const rp = new FlagsRowProcessor();

			// Prior generation loads only the top 30 (paged; hasMore below).
			const prior = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: false },
				rowProcessor: rp,
				limit: 30,
			});
			assert.strictEqual(prior.rows.length, 30);
			assert.strictEqual(prior.paging?.hasMore, true);
			const seed = makeSeed(repo.path, prior.rows, prior);

			// Add 5 new commits at head → they push 5 of the loaded rows below the limit=30 window.
			addCommits(repo.path, 5, 'top');
			repo.provider.cache.clearCaches(repo.path);

			const expected = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: false },
				rowProcessor: rp,
				limit: 30,
			});
			let outcome: IncrementalGraphOutcome | undefined;
			const actual = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: false },
				rowProcessor: rp,
				limit: 30,
				incrementalSeed: seed,
				reachabilitySeed: seed.reachability,
				onIncrementalResult: o => {
					outcome = o;
				},
			});

			assert.strictEqual(outcome?.path, 'fast', 'expected the fast path');
			assert.strictEqual(actual.rows.length, 30, 'window stays at the limit');
			assertGraphsEquivalent(expected, actual, { includeStats: false });
		} finally {
			repo.cleanup();
		}
	});

	// rev anchor: the host passes the loaded window's bottom sha as `rev` on every same-repo rebuild to
	// pin the window bottom. The fast path must honor it (grow the window down to the anchor instead of
	// trimming to `limit`) and stay byte-identical to a full walk WITH the same rev.

	test('rev anchor (seed bottom) grows the window past limit, matching a full walk with the same rev', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 40, 'p'); // 41 commits total (incl. the initial)
			const rp = new FlagsRowProcessor();

			// Prior generation: a full walk (rev = undefined) of the whole history. Its BOTTOM commit row is the
			// rebuild anchor the host would pass on the next same-repo rebuild.
			const prior = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: false },
				rowProcessor: rp,
			});
			assert.strictEqual(prior.paging?.hasMore, false, 'prior loaded the full history');
			const priorSize = prior.rows.length;
			const anchorSha = prior.rows.at(-1)!.sha;
			const seed = makeSeed(repo.path, prior.rows, prior);

			// One new commit at head. A plain `limit = priorSize` walk would push the anchor out; the anchor rev
			// prevents that (the walk grows the window down to — and including — the anchor).
			addCommit(repo.path, 'top.txt', 'top', 'New head commit');
			repo.provider.cache.clearCaches(repo.path);

			// EXPECTED: a full walk WITH the anchor rev at the same limit.
			const expected = await repo.provider.graph.getGraph(repo.path, anchorSha, {
				include: { stats: false },
				rowProcessor: rp,
				limit: priorSize,
			});

			// ACTUAL: the seeded fast path with the same anchor rev + limit.
			let outcome: IncrementalGraphOutcome | undefined;
			const actual = await repo.provider.graph.getGraph(repo.path, anchorSha, {
				include: { stats: false },
				rowProcessor: rp,
				limit: priorSize,
				incrementalSeed: seed,
				reachabilitySeed: seed.reachability,
				onIncrementalResult: o => {
					outcome = o;
				},
			});

			assert.strictEqual(outcome?.path, 'fast', 'expected the fast path');
			assert.strictEqual(actual.rows.length, priorSize + 1, 'the new commit grew the window past the limit');
			assert.strictEqual(actual.rows.at(-1)!.sha, anchorSha, 'the anchor rev is pinned at the window bottom');
			assertGraphsEquivalent(expected, actual, { includeStats: false });
		} finally {
			repo.cleanup();
		}
	});

	test('rev anchor with a paged seed: pins the anchor bottom, keeps hasMore, and pages identically', async () => {
		const repo = createTestRepo();
		try {
			addEmptyCommits(repo.path, 49, 'p'); // 50 commits total
			const rp = new FlagsRowProcessor();

			// Prior generation loads only the top 30 (paged; more history below). Its bottom row is the anchor.
			const prior = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: false },
				rowProcessor: rp,
				limit: 30,
			});
			assert.strictEqual(prior.rows.length, 30);
			assert.strictEqual(prior.paging?.hasMore, true);
			const anchorSha = prior.rows.at(-1)!.sha;
			const seed = makeSeed(repo.path, prior.rows, prior);

			// One new commit at head.
			addCommit(repo.path, 'top.txt', 'top', 'New head commit');
			repo.provider.cache.clearCaches(repo.path);

			const expected = await repo.provider.graph.getGraph(repo.path, anchorSha, {
				include: { stats: false },
				rowProcessor: rp,
				limit: 30,
			});
			let outcome: IncrementalGraphOutcome | undefined;
			const actual = await repo.provider.graph.getGraph(repo.path, anchorSha, {
				include: { stats: false },
				rowProcessor: rp,
				limit: 30,
				incrementalSeed: seed,
				reachabilitySeed: seed.reachability,
				onIncrementalResult: o => {
					outcome = o;
				},
			});

			assert.strictEqual(outcome?.path, 'fast', 'expected the fast path');
			// The new commit on top + the anchor rev pinned at the bottom → window grows from 30 to 31.
			assert.strictEqual(actual.rows.length, 31, 'window grew to include the anchor');
			assert.strictEqual(actual.rows.at(-1)!.sha, anchorSha, 'the anchor rev is pinned at the window bottom');
			assert.strictEqual(actual.paging?.hasMore, true, 'more history remains below the seed');
			assertGraphsEquivalent(expected, actual, { includeStats: false });

			// The next more() page from the fast-path graph must equal the full-walk graph's more() page.
			const expectedNext = await expected.more!(30);
			const actualNext = await actual.more!(30);
			assert.ok(expectedNext != null && actualNext != null);
			assertGraphsEquivalent(expectedNext, actualNext, { includeStats: false });
		} finally {
			repo.cleanup();
		}
	});
});
