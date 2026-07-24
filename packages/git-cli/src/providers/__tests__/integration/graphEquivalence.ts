/**
 * Byte-equivalence harness for the R6b incremental head-walk (built here in R6a, exercised trivially
 * until R6b lights the fast path up). The contract R6b must satisfy:
 *
 *   full-walk(mutated repo)  ==  incremental-walk(pre-mutation seed, mutated repo)
 *
 * `assertGraphEquivalence` full-walks a repo (baseline → the incremental seed), applies a mutation,
 * full-walks again (EXPECTED), then walks with the `incrementalSeed` option (ACTUAL — in R6a getGraph
 * ignores the seed and falls through to the full walk, so this passes trivially) and deep-compares.
 *
 * Reachability equivalence rule (the load-bearing subtlety): the two walks legitimately assign
 * DIFFERENT raw `reachabilityIndex` values — EXPECTED mints a fresh table; ACTUAL continues the prior
 * table (via `reachabilitySeed`, exactly as R6b's fallback would), and a continued table indexes refs
 * differently and retains stale dictionary entries. So we NEVER compare raw indices or table ids;
 * instead we DECODE each row's set on both sides and compare the sorted ref memberships. This proves
 * the comparison is robust to index divergence NOW, before R6b introduces it for real.
 */

import * as assert from 'assert';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowContexts,
	GraphContext,
	GraphIncrementalSeed,
	GraphRowProcessor,
	IncrementalGraphOutcome,
} from '@gitlens/git/models/graph.js';
import {
	computeGraphRowContextFlags,
	decodeReachabilitySet,
	reachableRefKey,
} from '@gitlens/git/utils/reachability.utils.js';
import type { TestRepo } from './helpers.js';
import { getRefTips } from './helpers.js';

type DecodedRef = ReturnType<typeof decodeReachabilitySet>[number];

/**
 * Minimal row processor computing the {@link GitGraphRowContextFlags} via the SAME shared
 * `computeGraphRowContextFlags` the host's `GlGraphRowProcessor` and the R6b fast path use — so a flag
 * divergence can only come from a difference in the re-derived sets, never from a drifted flag mirror. The
 * vscode-only enrichment (serialized webview contexts, avatar URIs, emojify, current-user display
 * formatting) is skipped: it needs `Container`/`vscode` and, because BOTH walks use this same processor,
 * its absence is behavior-neutral for equivalence.
 */
export class FlagsRowProcessor implements GraphRowProcessor {
	processRow(row: GitGraphRow, context: GraphContext): void {
		// Stash contexts are vscode-serialized in production and carry no flags; nothing to compute here.
		if (row.type === 'stash-node') return;

		// Reads the transient per-row `reachability` (still present here) for the `+unique` count.
		(row.contexts ??= {}).flags = computeGraphRowContextFlags(row.sha, row.reachability?.refs, context);
	}
}

/**
 * Full-walk → mutate → full-walk (EXPECTED) → incremental-seeded walk (ACTUAL) → assert equivalent AND that
 * the seeded walk took `expectedOutcome` (fast path or the expected fallback reason). `mutate` applies the
 * repo change; caches are cleared afterward because the harness bypasses GitLens's change hooks (the walk's
 * branch/stash/worktree queries would otherwise return stale cached results).
 */
export async function assertGraphEquivalence(
	repo: TestRepo,
	mutate: (repoPath: string) => void | Promise<void>,
	expectedOutcome: IncrementalGraphOutcome,
	options?: { stats?: boolean },
): Promise<void> {
	const { provider, path: repoPath } = repo;
	const includeStats = options?.stats ?? true;
	const rowProcessor = new FlagsRowProcessor();

	// 1. Pre-mutation baseline — the source of the incremental seed (the prior generation's artifacts).
	const pre = await provider.graph.getGraph(repoPath, undefined, {
		include: { stats: includeStats },
		rowProcessor: rowProcessor,
	});
	await pre.rowsStatsDeferred?.promise;

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

	// 2. Apply the repo change, then reset the provider caches (see note above).
	await mutate(repoPath);
	provider.cache.clearCaches(repoPath);

	// 3. EXPECTED: a plain full walk of the mutated repo (fresh reachability generation).
	const expected = await provider.graph.getGraph(repoPath, undefined, {
		include: { stats: includeStats },
		rowProcessor: rowProcessor,
	});
	await expected.rowsStatsDeferred?.promise;

	// 4. ACTUAL: the incremental-seeded walk. Passes `reachabilitySeed`/`rowsStatsSeed` (as the fast path's
	// fallback would) so ACTUAL CONTINUES the prior reachability table — making its raw `reachabilityIndex`
	// values legitimately differ from EXPECTED's fresh table, exercising the decoded-membership comparison.
	let outcome: IncrementalGraphOutcome | undefined;
	const actual = await provider.graph.getGraph(repoPath, undefined, {
		include: { stats: includeStats },
		rowProcessor: rowProcessor,
		incrementalSeed: seed,
		reachabilitySeed: pre.reachability,
		rowsStatsSeed: pre.rowsStats,
		onIncrementalResult: o => {
			outcome = o;
		},
	});
	await actual.rowsStatsDeferred?.promise;

	// Compare path + fallback reason only; the fast outcome also carries an observational `added` count
	// (new-row tally for the host log) that isn't part of the equivalence contract.
	assert.strictEqual(outcome?.path, expectedOutcome.path, 'incremental path mismatch');
	assert.strictEqual(outcome?.reason, expectedOutcome.reason, 'incremental fallback reason mismatch');
	assertGraphsEquivalent(expected, actual, { includeStats: includeStats });
}

/** Deep-compares two graphs field-by-field with first-divergence reporting. See the module doc for the reachability rule. */
export function assertGraphsEquivalent(
	expected: GitGraph,
	actual: GitGraph,
	options?: { includeStats?: boolean },
): void {
	// Graph id = HEAD sha at walk time.
	assert.strictEqual(actual.id, expected.id, 'graph.id mismatch');

	// ids set — compared as an ordered array (insertion order == row emission order).
	assert.deepStrictEqual([...actual.ids], [...expected.ids], 'ids set / order mismatch');

	assert.strictEqual(
		actual.rows.length,
		expected.rows.length,
		`row count mismatch: expected ${expected.rows.length}, actual ${actual.rows.length}`,
	);

	for (let i = 0; i < expected.rows.length; i++) {
		const e = expected.rows[i];
		const a = actual.rows[i];

		// Every row field EXCEPT `reachabilityIndex` (index divergence is expected) and the stripped
		// `reachability` transient. Fails at the FIRST divergent row, surfacing that row's field diff.
		assert.deepStrictEqual(
			normalizeRow(a),
			normalizeRow(e),
			`row ${i} (sha ${e.sha}) diverges in a field other than reachabilityIndex`,
		);

		// Reachability compared by DECODED membership (order-normalized), never by raw index.
		assert.deepStrictEqual(
			decodedRefs(actual, a),
			decodedRefs(expected, e),
			`row ${i} (sha ${e.sha}) reachability membership diverges`,
		);
	}

	assert.deepStrictEqual(
		normalizeDownstreams(actual.downstreams),
		normalizeDownstreams(expected.downstreams),
		'downstreams mismatch',
	);

	assert.deepStrictEqual(
		sortedSet(actual.reachableFromHEAD),
		sortedSet(expected.reachableFromHEAD),
		'reachableFromHEAD mismatch',
	);
	assert.deepStrictEqual(
		sortedSet(actual.rewriteableFromHEAD),
		sortedSet(expected.rewriteableFromHEAD),
		'rewriteableFromHEAD mismatch',
	);

	// Side-queried collections (not walk-derived; compared lightly for completeness).
	assert.deepStrictEqual(branchSummary(actual), branchSummary(expected), 'branches mismatch');
	assert.deepStrictEqual(remoteSummary(actual), remoteSummary(expected), 'remotes mismatch');
	assert.deepStrictEqual(stashSummary(actual), stashSummary(expected), 'stashes mismatch');
	assert.deepStrictEqual(worktreeSummary(actual), worktreeSummary(expected), 'worktrees mismatch');

	assert.deepStrictEqual(sortedEntries(actual.avatars), sortedEntries(expected.avatars), 'avatars mismatch');
	assert.deepStrictEqual(actual.paging, expected.paging, 'paging mismatch');

	if (options?.includeStats) {
		assert.deepStrictEqual(
			sortedEntries(actual.rowsStats),
			sortedEntries(expected.rowsStats),
			'rowsStats mismatch',
		);
	}
}

/**
 * Strips `reachabilityIndex` (compared via decoded membership) and the stripped `reachability` transient, then
 * JSON-normalizes so `key: undefined` and an absent key compare equal. That last step matters for R7c: a
 * restore's REUSED rows are round-tripped through JSON (persistence drops undefined-valued keys like a
 * remote-less head's `upstream`/`worktreeId`), while a fresh walk emits them explicitly — semantically
 * identical. Benign for fresh-vs-fresh comparisons (both sides normalize the same way).
 */
function normalizeRow(row: GitGraphRow): unknown {
	const { reachability: _reachability, contexts, ...rest } = row;
	let normalizedContexts: Omit<GitGraphRowContexts, 'reachabilityIndex'> | undefined;
	if (contexts != null) {
		const { reachabilityIndex: _reachabilityIndex, ...ctx } = contexts;
		normalizedContexts = ctx;
	}
	return JSON.parse(JSON.stringify({ ...rest, contexts: normalizedContexts }));
}

/** A row's reachable-ref set, decoded from the graph's table and sorted into a canonical order. */
function decodedRefs(graph: GitGraph, row: GitGraphRow): DecodedRef[] {
	const index = row.contexts?.reachabilityIndex;
	if (index == null || graph.reachability == null) return [];
	return [...decodeReachabilitySet(graph.reachability, index)].sort((a, b) =>
		reachableRefKey(a) < reachableRefKey(b) ? -1 : reachableRefKey(a) > reachableRefKey(b) ? 1 : 0,
	);
}

function sortedSet(set: ReadonlySet<string> | undefined): string[] {
	return [...(set ?? [])].sort();
}

function sortedEntries<V>(map: ReadonlyMap<string, V> | undefined): [string, V][] {
	return [...(map?.entries() ?? [])].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function byFirstKey<V>(a: [string, V], b: [string, V]): number {
	return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/** Downstreams compared order-insensitively (upstream → tracking-branch grouping; order isn't meaningful). */
function normalizeDownstreams(map: ReadonlyMap<string, string[]>): [string, string[]][] {
	return Array.from(map, ([k, v]): [string, string[]] => [k, [...v].sort()]).sort(byFirstKey);
}

function branchSummary(
	g: GitGraph,
): [string, { sha: string | undefined; current: boolean; upstream: string | undefined }][] {
	return Array.from(
		g.branches,
		([name, b]): [string, { sha: string | undefined; current: boolean; upstream: string | undefined }] => [
			name,
			{ sha: b.sha, current: b.current, upstream: b.upstream?.name },
		],
	).sort(byFirstKey);
}

function remoteSummary(g: GitGraph): [string, { url: string }][] {
	return Array.from(g.remotes, ([name, r]): [string, { url: string }] => [name, { url: r.url }]).sort(byFirstKey);
}

function stashSummary(g: GitGraph): [string, { number: string | undefined; message: string | undefined }][] {
	if (g.stashes == null) return [];

	return Array.from(g.stashes, ([sha, s]): [string, { number: string | undefined; message: string | undefined }] => [
		sha,
		{ number: s.stashNumber, message: s.message },
	]).sort(byFirstKey);
}

function worktreeSummary(g: GitGraph): { path: string; sha: string | undefined; branch: string | undefined }[] {
	return (g.worktrees ?? [])
		.map(w => ({ path: w.path, sha: w.sha, branch: w.branch?.name }))
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
