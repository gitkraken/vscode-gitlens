import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { GitSearchError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitStashCommit } from '@gitlens/git/models/commit.js';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowsStats,
	GitGraphRowStats,
	GitGraphRowTag,
	GraphContext,
	GraphIncrementalSeed,
	GraphReachabilityTable,
	GraphRowProcessor,
	IncrementalGraphFallbackReason,
	IncrementalGraphOutcome,
} from '@gitlens/git/models/graph.js';
import type {
	GitGraphSearch,
	GitGraphSearchCursor,
	GitGraphSearchProgress,
	GitGraphSearchResultData,
	GitGraphSearchResults,
} from '@gitlens/git/models/graphSearch.js';
import { graphSessionSnapshotVersion } from '@gitlens/git/models/graphSession.js';
import type {
	GitGraphSession,
	GitGraphSessionChangedChannels,
	GitGraphSessionRefreshOptions,
	GitGraphSessionRefreshResult,
	GitGraphSessionSnapshot,
	GraphSessionRestoreDiscardReason,
	GraphSessionRestoreResult,
} from '@gitlens/git/models/graphSession.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import type { GitGraphSubProvider } from '@gitlens/git/providers/graph.js';
import {
	getBranchId,
	getBranchNameWithoutRemote,
	getRemoteNameFromBranchName,
} from '@gitlens/git/utils/branch.utils.js';
import { getChangedFilesCount } from '@gitlens/git/utils/commit.utils.js';
import { appendRowsAtCursor, mergeAvatarsForward } from '@gitlens/git/utils/graph.utils.js';
import { computeGraphRowContextFlags, createReachabilityTableBuilder } from '@gitlens/git/utils/reachability.utils.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import { getSearchQueryComparisonKey, parseSearchQueryGitCommand } from '@gitlens/git/utils/search.utils.js';
import { getTagId } from '@gitlens/git/utils/tag.utils.js';
import { isUserMatch } from '@gitlens/git/utils/user.utils.js';
import { getWorktreeId, groupWorktreesByBranch } from '@gitlens/git/utils/worktree.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { fnv1aHash64 } from '@gitlens/utils/hash.js';
import { find, first, join, last } from '@gitlens/utils/iterable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { Git } from '../exec/git.js';
import { gitConfigsLog } from '../exec/git.js';
import {
	getGraphParser,
	getShaAndDatesLogParser,
	getShaAndDatesWithFilesLogParser,
	getShaAndStatsLogParser,
	getShaLogParser,
} from '../parsers/logParser.js';
import { convertStashesToStdin } from './stash.js';

const progressiveSearchResultsBatchTimeMs = 500; // Send updates every 500ms (2 updates/second)

type ReachableRef = GitCommitReachability['refs'][number];

/**
 * Whether a ref participates in graph row decoration (a branch/remote/tag badge) and so must be diffed by
 * the R6b tip gate. Excludes `refs/stash` (handled by the stash gate) and symbolic `…/HEAD` refs (they
 * mirror another ref and produce no badge of their own).
 */
function isMoveableGraphRef(refname: string): boolean {
	if (refname === 'refs/stash' || refname === 'HEAD' || refname.endsWith('/HEAD')) return false;

	return refname.startsWith('refs/heads/') || refname.startsWith('refs/remotes/') || refname.startsWith('refs/tags/');
}

/**
 * Fingerprints the GLOBAL side inputs row construction embeds into row decorations — the default branch
 * (and whether a local branch shadows it), HEAD's upstream, remote urls/providers, secondary-worktree
 * assignments, and the current user. These can all change WITHOUT moving any ref tip (`git remote
 * set-head`, remote/user config edits, `git worktree add`), and the R6b fast path reuses prior rows
 * wholesale (only flags/reachability are re-derived) — so it compares this against the seed's and falls
 * back to the full walk (which rebuilds every decoration) on ANY change. Deliberately EXCLUDES what other
 * gates already own — ref existence/tips (tip gate), the default worktree's checkout (HEAD gate), and
 * per-branch upstream mappings (checked row-by-row against the seed's embedded pills, so tracking-branch
 * CREATES stay fast) — keeping the high-frequency events (commits, branch/tag creates, fetches,
 * checkouts) on the fast path. Sorted so map/list iteration order can't produce spurious mismatches.
 */
function computeDecorationFingerprint(
	repoPath: string,
	defaultBranchName: string | undefined,
	defaultLocalName: string | undefined,
	headRefUpstreamName: string | undefined,
	branches: readonly GitBranch[] | undefined,
	remotes: readonly GitRemote[] | undefined,
	worktrees: readonly GitWorktree[],
	currentUser: { name: string | undefined; email: string | undefined } | undefined,
): string {
	// Remote-head default markers read `!branchMap.has(defaultLocalName)` — a local branch appearing at (or
	// vanishing from) the default's local name flips them even though the DEFAULT ref itself didn't move.
	const localShadowsDefault = defaultLocalName != null && (branches?.some(b => b.name === defaultLocalName) ?? false);
	const parts: string[] = [
		`d:${defaultBranchName ?? ''}|${localShadowsDefault ? 's' : ''}`,
		`h:${headRefUpstreamName ?? ''}`,
		`u:${currentUser?.name ?? ''}|${currentUser?.email ?? ''}`,
	];
	if (branches != null) {
		for (const b of branches) {
			// `+starred` is baked into branch pills' serialized contexts (local AND remote heads); a
			// disposition change moves no ref tip, so it must bust the fingerprint. Star/unstar is rare —
			// one full walk per transition is fine.
			if (b.starred) {
				parts.push(`s:${b.name}`);
			}
		}
	}
	if (remotes != null) {
		for (const r of remotes) {
			parts.push(`r:${r.name}|${r.url}|${r.provider?.gkProviderId ?? ''}`);
		}
	}
	let defaultWorktreeBranch: string | undefined;
	let defaultWorktreePath: string | undefined;
	for (const w of worktrees) {
		if (w.isDefault) {
			defaultWorktreeBranch = w.branch?.name;
			defaultWorktreePath = w.path;
			continue;
		}
		// Only branch-attached SECONDARY worktrees decorate rows: bare/detached ones are excluded from
		// `worktreesByBranch` (no pill). NOTE: `w.name` is deliberately avoided; it embeds the checked-out
		// branch (and a detached sha), which would bust this on every checkout.
		if (w.type !== 'branch') continue;

		parts.push(`w:${w.branch?.name ?? ''}|${w.path}`);
	}
	// The DEFAULT worktree's checkout flips `+checkedout` / the main-path worktree recovery on two branch
	// pills. When the graph IS the default worktree, that's the ordinary HEAD move (the HEAD gate refetches
	// both endpoint rows) — but a graph on a SECONDARY worktree sees no HEAD move when the MAIN worktree
	// checks out, so the assignment must fingerprint there. (`w.path` for the default worktree equals the
	// main repo path in this provider's normalization — pinned by a WorktreesSubProvider test.)
	if (defaultWorktreePath != null && defaultWorktreePath !== repoPath) {
		parts.push(`wd:${defaultWorktreeBranch ?? ''}`);
	}
	parts.sort();
	return fnv1aHash64(parts.join('\x00'));
}

/**
 * Whether the shared reachability TABLE changed between two refresh generations. The table is append-only
 * within a generation (`id`), so a new `id` or a grown dictionary/sets length is an EXACT signal — a per-row
 * index that re-points to an already-present set doesn't grow the table (that change rides the rows channel).
 */
function reachabilityTableChanged(
	prior: GraphReachabilityTable | undefined,
	next: GraphReachabilityTable | undefined,
): boolean {
	if (prior == null || next == null) return prior !== next;

	return (
		prior.id !== next.id ||
		prior.dictionary.length !== next.dictionary.length ||
		prior.sets.length !== next.sets.length
	);
}

/**
 * Whether the downstreams map (upstream name → tracking branch names) changed between two refresh
 * generations. Order-sensitive on the arrays: a mere reorder reports "changed" and re-ships the full map,
 * which is harmless — a false negative would silently drop a real upstream change, so err toward "changed".
 */
function downstreamsChanged(prior: ReadonlyMap<string, string[]>, next: ReadonlyMap<string, string[]>): boolean {
	if (prior.size !== next.size) return true;

	for (const [key, priorNames] of prior) {
		const nextNames = next.get(key);
		if (nextNames == null || nextNames.length !== priorNames.length) return true;

		for (let i = 0; i < priorNames.length; i++) {
			if (priorNames[i] !== nextNames[i]) return true;
		}
	}
	return false;
}

/**
 * Cap on the number of window rows a {@link GraphSession.serialize} persists. A longer window persists only
 * its TOP slice with `hasMore` forced true (restore then behaves as a shorter loaded window — the bottom
 * re-pages on demand). Pragmatic: generous enough that a typical session restores its whole window, bounded
 * enough that the JSON file stays sub-MB-class (rows are a few hundred bytes each).
 */
const maxPersistedGraphRows = 2000;

/** The walk-shape key (`ordering|onlyFollowFirstParent`) an incremental seed is gated on — one builder so the
 *  restore/refresh/rebuild sites can't drift in how they stringify it. */
function buildShapeKey(shape: { ordering: string; onlyFollowFirstParent: boolean }): string {
	return `${shape.ordering}|${shape.onlyFollowFirstParent}`;
}

/**
 * Validates a persisted {@link GitGraphSessionSnapshot} structurally before it's trusted to seed a restore.
 * Returns the discard reason on any failure (→ the caller ignores the snapshot and does a normal initial
 * walk), or `undefined` when it's coherent. Never throws — a corrupt/adversarial cache must degrade to a
 * full walk, never crash the open. Deep validation (does the cache match current git?) is NOT done here:
 * that's the restore's immediate refresh, which reconciles a stale-but-valid snapshot against ground truth.
 */
function validateGraphSnapshot(
	snapshot: GitGraphSessionSnapshot,
	repoPath: string,
	currentBuildShape: string,
): GraphSessionRestoreDiscardReason | undefined {
	if (snapshot.v !== graphSessionSnapshotVersion) return 'schema';
	if (snapshot.repoPath !== repoPath) return 'repo-path';
	// A shape change reshapes every row's parents/order — the cached rows can't be reused.
	if (snapshot.buildShape !== currentBuildShape) return 'shape';
	if (!Array.isArray(snapshot.rows) || snapshot.rows.length === 0) return 'empty';
	if (
		!Array.isArray(snapshot.refTips) ||
		snapshot.refTips.some(
			t => !Array.isArray(t) || t.length !== 2 || typeof t[0] !== 'string' || typeof t[1] !== 'string',
		)
	) {
		return 'tips';
	}

	// Each row must be structurally sane — a corrupt row poisons the seed / stitch math. Duplicate shas break
	// the ids set / stitch dedup (they'd re-appear as "already seen"), so reject them too.
	const seenShas = new Set<string>();
	for (const row of snapshot.rows) {
		if (row == null || typeof row.sha !== 'string' || !Array.isArray(row.parents) || typeof row.date !== 'number') {
			return 'rows';
		}
		if (seenShas.has(row.sha)) return 'rows';

		seenShas.add(row.sha);
	}

	// Every row's `reachabilityIndex` must be a valid index into the table's `sets` (the decode reads it
	// directly). Guards against a truncated table / mismatched pairing.
	const reachability = snapshot.reachability;
	if (reachability != null && (!Array.isArray(reachability.sets) || !Array.isArray(reachability.dictionary))) {
		return 'reachability';
	}

	const setCount = reachability?.sets?.length ?? 0;
	for (const row of snapshot.rows) {
		const index = row.contexts?.reachabilityIndex;
		if (index != null && (!Number.isInteger(index) || index < 0 || index >= setCount)) return 'reachability';
	}

	// Downstreams must be `[upstream name, tracking branch names]` entries (reconstructed into a Map on restore).
	if (
		!Array.isArray(snapshot.downstreams) ||
		snapshot.downstreams.some(
			d => !Array.isArray(d) || d.length !== 2 || typeof d[0] !== 'string' || !Array.isArray(d[1]),
		)
	) {
		return 'downstreams';
	}

	// Per-sha stats, when present, must be `[sha, stats-object]` entries (reconstructed into a Map on restore).
	if (
		snapshot.rowsStats != null &&
		(!Array.isArray(snapshot.rowsStats) ||
			snapshot.rowsStats.some(
				s =>
					!Array.isArray(s) ||
					s.length !== 2 ||
					typeof s[0] !== 'string' ||
					typeof s[1] !== 'object' ||
					s[1] == null,
			))
	) {
		return 'rowsStats';
	}

	return undefined;
}

/**
 * Reconstruct a persisted snapshot into the synthetic `GitGraph` a {@link GraphSession.restore} hands to its
 * immediate refresh as the PRIOR generation — carrying exactly the fields the refresh's seed construction +
 * change-diffing read (`refTips`, `reachability`, `rowsStats`, `downstreams`, `paging.hasMore`). Avatars are
 * deliberately empty: resolved avatar URLs are webview-instance-bound and don't survive a restart, so the
 * refresh re-derives them (and the write-once merge over an empty prior map is a no-op). The side-queried
 * collections (`branches`/`remotes`/`stashes`/`worktrees`) aren't read by the refresh, so they're left empty.
 */
function buildRestoredGraph(snapshot: GitGraphSessionSnapshot): GitGraph {
	return {
		repoPath: snapshot.repoPath,
		avatars: new Map<string, string>(),
		ids: new Set<string>(snapshot.rows.map(r => r.sha)),
		includes: snapshot.includesStats ? { stats: true } : undefined,
		branches: new Map<string, GitBranch>(),
		remotes: new Map<string, GitRemote>(),
		downstreams: new Map(snapshot.downstreams),
		stashes: undefined,
		worktrees: undefined,
		worktreesByBranch: undefined,
		reachability: snapshot.reachability,
		refTips: new Map(snapshot.refTips),
		decorationFingerprint: snapshot.decorationFingerprint,
		shallow: snapshot.shallow,
		rows: snapshot.rows,
		rowsStats: snapshot.rowsStats != null ? new Map(snapshot.rowsStats) : undefined,
		paging: { limit: snapshot.rows.length, startingCursor: undefined, hasMore: snapshot.hasMore },
	};
}

/** The graph log parser's per-record shape (see `graphMapping`), narrowed to the fields the row builder reads. */
type GraphCommitRecord = {
	sha: string;
	author: string;
	authorEmail: string;
	authorDate: string;
	committerDate: string;
	parents: string;
	tips: string;
	message: string;
	stats?: GitGraphRowStats;
};

export class GraphGitSubProvider implements GitGraphSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	/**
	 * Current ref tips (canonical refname → PEELED commit sha), for the R6b fast path's gate. Peeled so an
	 * annotated tag maps to the commit its badge sits on — the same convention {@link GraphIncrementalSeed.tips}
	 * uses — and so the seed↔current diff is by commit identity. Skips nothing; the caller filters to the
	 * moveable ref classes it cares about.
	 */
	private async getCurrentRefTips(repoPath: string, cancellation?: AbortSignal): Promise<Map<string, string>> {
		const result = await this.git.run(
			{ cwd: repoPath, configs: gitConfigsLog, cancellation: cancellation, errors: 'ignore' },
			'for-each-ref',
			'--format=%(objectname) %(*objectname) %(refname)',
		);
		const tips = new Map<string, string>();
		for (const line of result.stdout.split('\n')) {
			// `<objectname> <peeled-objectname-or-empty> <refname>`; peeled is set only for annotated tags.
			const match = /^(\S+) (\S*) (.+)$/.exec(line);
			if (match == null) continue;

			tips.set(match[3], match[2] || match[1]);
		}
		return tips;
	}

	/**
	 * Whether the repo is a SHALLOW clone right now (a `$GIT_DIR/shallow` file exists). `git` resolves the git
	 * dir itself (correct in worktrees / bare / separate git-dirs), so this makes no `.git`-is-a-dir assumption.
	 * Returned as {@link GitGraph.shallow} and diffed by the R6b fast path's gate — an un-shallow (or re-shallow)
	 * while the graph was closed leaves every branch tip put yet changes what history exists below the window.
	 * Errors ignored → treated as NOT shallow: a git too old for `--is-shallow-repository` degrades to no-op
	 * detection (consistent on both the seed and the current side, so the gate can't over-fire), and a transient
	 * read error biases toward `false`, which — when the seed was shallow — only forces a SAFE full-walk fallback.
	 */
	private async getShallowState(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		const result = await this.git.run(
			{ cwd: repoPath, configs: gitConfigsLog, cancellation: cancellation, errors: 'ignore' },
			'rev-parse',
			'--is-shallow-repository',
		);
		return result.stdout.trim() === 'true';
	}

	/** Whether `oldSha` is an ancestor of `newSha` (i.e. the ref moved fast-forward). */
	private async isFastForward(
		repoPath: string,
		oldSha: string,
		newSha: string,
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const result = await this.git.run(
			{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
			'merge-base',
			'--is-ancestor',
			oldSha,
			newSha,
		);
		return result.exitCode === 0;
	}

	async openGraphSession(
		repoPath: string,
		options?: {
			rowProcessor?: GraphRowProcessor;
			rev?: string;
			limit?: number;
			include?: { stats?: boolean };
			restore?: GitGraphSessionSnapshot;
			onRestore?: (result: GraphSessionRestoreResult) => void;
		},
		cancellation?: AbortSignal,
	): Promise<GitGraphSession> {
		// The session computes the walk shape (`ordering|onlyFollowFirstParent`) the SAME way `getGraph`
		// derives it, so it can gate its incremental seed on a shape change (which reshapes every row's
		// parents/order) exactly as the host's former `_graphBuildShape` gate did.
		const getWalkShape = (): { ordering: 'date' | 'author-date' | 'topo'; onlyFollowFirstParent: boolean } => {
			const cfg = this.context.config;
			return {
				ordering: cfg?.graph?.commitOrdering ?? cfg?.commits.ordering ?? 'date',
				onlyFollowFirstParent: cfg?.graph?.onlyFollowFirstParent ?? false,
			};
		};
		const session = new GraphSession(this, repoPath, options?.rowProcessor, getWalkShape);

		// R7c restart persistence: seed from a persisted snapshot when it's structurally valid for THIS repo +
		// walk shape, then immediately refresh (the snapshot is exactly an R6 seed — enumeration + the tip/FF/
		// stash gates reconcile a stale one). Any validation failure discards it and falls through to a normal
		// initial walk. Never trusted over git.
		const restore = options?.restore;
		if (restore != null) {
			const shape = getWalkShape();
			const reason = validateGraphSnapshot(restore, repoPath, buildShapeKey(shape));
			if (reason == null) {
				try {
					const refresh = await session.restore(restore, options, cancellation);
					options?.onRestore?.({ restored: true, rows: restore.rows.length, refresh: refresh });
					return session;
				} catch {
					// Belt-and-suspenders: structural validation can't catch a snapshot that reconstructs but
					// throws in the restore's refresh (e.g. a garbage rev its enumerate chokes on). A corrupt
					// cache must degrade to a full walk, never crash the open — report a miss and fall through.
					options?.onRestore?.({ restored: false, reason: 'corrupt' });
				}
			} else {
				options?.onRestore?.({ restored: false, reason: reason });
			}
		}

		await session.initialize(options, cancellation);
		return session;
	}

	@debug()
	async getGraph(
		repoPath: string,
		rev: string | undefined,
		options?: {
			include?: { stats?: boolean };
			limit?: number;
			rowProcessor?: GraphRowProcessor;
			reachabilitySeed?: GraphReachabilityTable;
			rowsStatsSeed?: GitGraphRowsStats;
			// R6b incremental head-walk seed. When present (and the gate holds), walk only the new head
			// region, stitch the seed's cached tail, and re-derive flags/reachability in memory instead of
			// re-walking every loaded row; any structural change degrades to the full walk. See
			// `GraphIncrementalSeed` and the R6 plan section.
			incrementalSeed?: GraphIncrementalSeed;
			// Observational: reports whether the seeded call took the fast path or fell back (with the reason).
			onIncrementalResult?: (outcome: IncrementalGraphOutcome) => void;
		},
		cancellation?: AbortSignal,
	): Promise<GitGraph> {
		const scope = getScopedLogger();

		const cfg = this.context.config;
		const defaultLimit = options?.limit ?? 5000;
		const ordering: 'date' | 'author-date' | 'topo' = cfg?.graph?.commitOrdering ?? cfg?.commits.ordering ?? 'date';
		const onlyFollowFirstParent = cfg?.graph?.onlyFollowFirstParent ?? false;

		const deferStats = options?.include?.stats;
		// `let`: cleared before the fallback walk when the fast path bailed for a parent-rewriting reason
		// (unshallow / replace-ref change) — those alter boundary commits' true diffs, so per-sha stats
		// carried from the prior generation may be stale and must recompute.
		let rowsStatsSeed = options?.rowsStatsSeed;

		const parser = getGraphParser(options?.include?.stats && !deferStats);
		const shaParser = getShaLogParser();
		const statsParser = getShaAndStatsLogParser();

		const stashPromise = this.provider.stash?.getStash(repoPath, { includeFiles: false }, cancellation);

		// Pre-BUILD the first walk's stream as soon as the stash list (the spawn's only argv/stdin
		// input) resolves. NOTE: `git.stream` is a lazy async generator — the process does NOT spawn
		// until the walk loop's first iteration, so this achieves argv/stdin PREPARATION overlap only,
		// not the git-startup overlap the original design intended (make the spawn eager — priming the
		// generator — or delete this seam; tracked as a follow-up). Consumed exactly once by the first
		// `getCommitsForGraphCore` call; never iterated = never spawned, so an unconsumed pre-build
		// (fast-path win, error fallback) leaks nothing.
		const prespawnAborter = new AbortController();
		const onPrespawnCancel = () => prespawnAborter.abort();
		cancellation?.addEventListener('abort', onPrespawnCancel, { once: true });
		// An ALREADY-aborted signal never fires listeners added after the fact — propagate it by hand.
		if (cancellation?.aborted) {
			onPrespawnCancel();
		}
		let prespawn: Promise<{ stream: AsyncGenerator<string> } | undefined> | undefined = (async () => {
			try {
				const gitStash = await stashPromise;
				const { stdin } = convertStashesToStdin(gitStash?.stashes);
				const args = ['log', ...parser.arguments, `--${ordering}-order`, '--all'];
				if (stdin) {
					args.push('--stdin');
				}
				if (onlyFollowFirstParent) {
					args.push('--first-parent');
				}
				const stream = this.git.stream(
					{
						cwd: repoPath,
						configs: gitConfigsLog,
						cancellation: prespawnAborter.signal,
						stdin: stdin,
						// See the walk spawn below for why GIT_FLUSH=0.
						env: { GIT_FLUSH: '0' },
					},
					...args,
					'--',
				);
				return { stream: stream };
			} catch {
				return undefined;
			}
		})();

		// Current ref tips (peeled), captured ONCE at walk entry, overlapped with the rest of the prelude (a
		// single `for-each-ref`, off the rows-walk critical path). Attached to the returned graph as `refTips`
		// so the host can seed the NEXT rebuild's tip diff; the R6b fast path also reuses this same map for its
		// own tip-diff gate (so there's exactly one `for-each-ref` per call whether it goes fast or full).
		const refTipsPromise = this.getCurrentRefTips(repoPath, cancellation);

		// Shallow state (peeled off the same prelude, off the rows-walk critical path) — stamped on the returned
		// graph so the NEXT rebuild's seed can gate on an un-shallow/re-shallow, and reused by the R6b fast path's
		// own shallow gate (one `rev-parse` per call whether it goes fast or full).
		const shallowPromise = this.getShallowState(repoPath, cancellation);

		const [
			shaResult,
			stashResult,
			branchesResult,
			remotesResult,
			currentUserResult,
			worktreesResult,
			defaultBranchResult,
		] = await Promise.allSettled([
			!isUncommitted(rev, true)
				? this.git.run(
						{ cwd: repoPath, configs: gitConfigsLog },
						'log',
						...shaParser.arguments,
						'-n1',
						rev ?? 'HEAD',
						'--',
					)
				: undefined,
			stashPromise,
			this.provider.branches.getBranches(repoPath, undefined, cancellation),
			this.provider.remotes.getRemotes(repoPath, undefined, cancellation),
			this.provider.config.getCurrentUser(repoPath),
			this.provider.worktrees
				?.getWorktrees(repoPath, cancellation)
				.then((w): [GitWorktree[], Map<string, GitWorktree>] => [
					w,
					groupWorktreesByBranch(w, { includeDefault: true }),
				]),
			// Local-only: never contact the remote on the graph's hot fetch path. `isDefault` is additive,
			// so it's simply absent until a background networked caller resolves origin/HEAD.
			this.provider.branches.getDefaultBranchName(repoPath, undefined, { local: true }, cancellation),
		]);

		const branches = getSettledValue(branchesResult)?.values;
		const branchMap = branches != null ? new Map(branches.map(r => [r.name, r])) : new Map<string, GitBranch>();
		const headBranch = branches?.find(b => b.current);
		const headRefUpstreamName = headBranch?.upstream?.name;
		const [worktrees, worktreesByBranch] = getSettledValue(worktreesResult) ?? [[], new Map<string, GitWorktree>()];

		// The repo's default branch (e.g. `origin/main`) reduced to its local branch name (`main`) so it
		// can be matched against each local head's `tip` to flag the default-branch head additively.
		const defaultBranchName = getSettledValue(defaultBranchResult);
		const defaultLocalName = defaultBranchName != null ? getBranchNameWithoutRemote(defaultBranchName) : undefined;

		let branchIdOfMainWorktree: string | undefined;
		let mainWorktree: GitWorktree | undefined;
		if (worktreesByBranch != null) {
			const defaultEntry = find(worktreesByBranch, ([, wt]) => wt.isDefault);
			if (defaultEntry != null) {
				[branchIdOfMainWorktree, mainWorktree] = defaultEntry;
				// Remove the main/default worktree so the branch-row decoration shows `+checkedout`
				// (not `+worktree`) for the main checkout. `mainWorktree` is retained below purely so
				// Undo Commit can still reach the main worktree's HEAD from a secondary worktree's graph.
				worktreesByBranch.delete(branchIdOfMainWorktree);
			}
		}

		const currentUser = getSettledValue(currentUserResult);

		const remotes = getSettledValue(remotesResult);
		const remoteMap = remotes != null ? new Map(remotes.map(r => [r.name, r])) : new Map<string, GitRemote>();

		// Decoration side inputs, fingerprinted for the NEXT rebuild's metadata gate (and compared against
		// the seed's by this call's fast path). Computed from the prelude's fresh queries — the same values
		// row construction below embeds into row decorations.
		const decorationFingerprint = computeDecorationFingerprint(
			repoPath,
			defaultBranchName,
			defaultLocalName,
			headRefUpstreamName,
			branches,
			remotes,
			worktrees,
			currentUser,
		);
		const shas = getSettledValue(shaResult)?.stdout;
		const selectSha = shas != null ? first(shaParser.parse(shas)) : undefined;

		// Resolved off the critical path (started in the prelude). Same map for the full walk's `refTips`, the
		// fast path's tip-diff gate, and the fast path's `refTips`. Never rejects (errors ignored → empty map).
		const refTips = await refTipsPromise;
		// Same value for the full walk's `shallow`, the fast path's shallow gate, and the fast path's `shallow`.
		const shallow = await shallowPromise;

		const downstreamMap = new Map<string, string[]>();

		// There *HAS* to be a better way to get git log to return stashes, but this is the best we've found
		const gitStash = getSettledValue(stashResult);
		const { stdin, remappedIds } = convertStashesToStdin(gitStash?.stashes);

		const avatars = new Map<string, string>();
		const ids = new Set<string>();
		const reachableFromHEAD = new Set<string>();
		// SHAs on the first-parent chain from HEAD up to (excluding) the first merge commit — the only
		// commits a plain (non-`--rebase-merges`) interactive rebase can safely rewrite. `headSha` seeds
		// the chain; `rewriteableNextSha` tracks the next sha expected on it. Outer scope so they persist
		// across `more()` pagination, like `reachableFromHEAD`.
		const rewriteableFromHEAD = new Set<string>();
		let headSha: string | undefined;
		let rewriteableNextSha: string | undefined;
		// Undo Commit is offered only on a worktree HEAD that is a LEAF (nothing is built on it) —
		// undoing a commit other work is stacked on is unsafe. The leaf check is only needed for the
		// undo-eligible tips (the active HEAD + each worktree's HEAD), so track just those shas rather
		// than every commit, keeping this O(#worktrees) instead of O(#commits).
		const undoableTipShas = new Set<string>();
		if (headBranch?.sha != null) {
			undoableTipShas.add(headBranch.sha);
		}
		for (const wt of worktrees) {
			if (wt.sha != null) {
				undoableTipShas.add(wt.sha);
			}
		}
		// The subset of `undoableTipShas` that turn out to have a child (are an ancestor of another
		// commit) — i.e. NOT leaves. Built newest-first during the walk, so by the time a tip's row is
		// processed every newer commit (its only possible children) has been seen. Undo is withheld for
		// shas recorded here. Stash rows are excluded (a stash sitting on a tip must not block undoing it).
		const tipShasWithChildren = new Set<string>();
		// SHAs reachable from HEAD's tracking upstream tip. Combined with `reachableFromHEAD`,
		// this lets us mark commits as unpushed (reachable from HEAD but not from HEAD's upstream).
		const reachableFromHeadUpstream = new Set<string>();

		// Map<sha, Map<refKey, ref>> — inner map deduplicates refs during propagation
		const reachableRefs = new Map<string, Map<string, ReachableRef>>();

		// Stable, append-only reachability table built as we walk — the PRIMARY representation shipped to
		// consumers. Lives in the outer scope so it accumulates across `more()` pagination; indices
		// already assigned never change, since git reachability only propagates to older (later-walked)
		// commits. Per-row ref arrays are NOT retained — each row keeps only its set index
		// (`contexts.reachabilityIndex`), and the working `reachableRefs` entry is dropped once emitted.
		// The encoder lives next to its decoder in `reachability.utils` so the wire format can't drift.
		// A caller-supplied seed CONTINUES the prior generation's table (same id, stable indices) so
		// rows retained across a rebuild keep valid `reachabilityIndex` values.
		const reachabilityBuilder = createReachabilityTableBuilder(options?.reachabilitySeed);

		// Set-index cache keyed by the working ref-map INSTANCE: the propagation below transfers a
		// row's map wholesale to its (first) parent, so an entire chain interns the same object —
		// one real intern per chain instead of one per row. Maps only ever GROW (ref seeding adds
		// entries), so an unchanged size proves the cached index is still exact.
		const internCache = new WeakMap<Map<string, ReachableRef>, { size: number; index: number | undefined }>();

		function finalizeRowReachability(
			row: GitGraphRow,
			sha: string,
			refs: Map<string, ReachableRef> | undefined,
		): void {
			let setIndex;
			const cached = refs != null ? internCache.get(refs) : undefined;
			if (cached != null && cached.size === refs!.size) {
				setIndex = cached.index;
			} else {
				setIndex = reachabilityBuilder.intern(refs?.values());
				if (refs != null) {
					internCache.set(refs, { size: refs.size, index: setIndex });
				}
			}
			if (setIndex != null) {
				(row.contexts ??= {}).reachabilityIndex = setIndex;
			}
			// Drop the transient per-row arrays so emitted rows don't retain reachability, and release the
			// working entry — once a commit is emitted its children are all walked and its parents already
			// seeded, so nothing reads `reachableRefs.get(sha)` again (orderings keep parents after children).
			row.reachability = undefined;
			reachableRefs.delete(sha);
		}

		const rowStats: GitGraphRowsStats = new Map<string, GitGraphRowStats>();
		let pendingRowsStatsCount = 0;
		let iterations = 0;
		let total = 0;

		// Hoisted so the ordered walk AND the R6b incremental fast path share one context. It holds the
		// outer accumulator sets BY REFERENCE (they mutate in place across `more()` pagination / replay), so
		// building it once is equivalent to the prior per-call construction.
		const rowProcessor = options?.rowProcessor;
		const graphCtx: GraphContext | undefined =
			rowProcessor != null
				? {
						repoPath: repoPath,
						useAvatars: cfg?.graph?.avatars ?? true,
						branches: branchMap,
						remotes: remoteMap,
						worktreesByBranch: worktreesByBranch,
						branchIdOfMainWorktree: branchIdOfMainWorktree,
						stashes: gitStash?.stashes,
						reachableFromHEAD: reachableFromHEAD,
						rewriteableFromHEAD: rewriteableFromHEAD,
						tipShasWithChildren: tipShasWithChildren,
						// `undefined` when HEAD has no upstream, so the processor flags nothing as
						// unpublished; otherwise the live set (mutated during the walk, read by ref).
						reachableFromHeadUpstream: headRefUpstreamName != null ? reachableFromHeadUpstream : undefined,
						avatars: avatars,
					}
				: undefined;

		// Parses one commit record into a row (ref badges, parents, stash vs commit) but performs NO
		// reachability/HEAD/downstream accumulation — that half lives in `accumulateRowState`, so the ordered
		// walk and the fast path (which replays accumulation over reused rows, deriving ref lists from their
		// own decoration) share one propagation implementation. Returns `undefined` when the record dedups to
		// an already-seen remapped-stash sha. Faithful extraction of the walk's former inline body — must stay
		// byte-identical to it (the equivalence harness pins this).
		function buildRowFromCommit(commit: GraphCommitRecord):
			| {
					row: GitGraphRow;
					refHeads: GitGraphRowHead[];
					refRemoteHeads: GitGraphRowRemoteHead[];
					refTags: GitGraphRowTag[];
					head: boolean;
					parents: string[];
			  }
			| undefined {
			total++;
			let shaOrRemapped: string | undefined = remappedIds.get(commit.sha);
			if (shaOrRemapped && ids.has(shaOrRemapped)) return undefined;

			shaOrRemapped ??= commit.sha;
			ids.add(shaOrRemapped);

			const refHeads: GitGraphRowHead[] = [];
			const refRemoteHeads: GitGraphRowRemoteHead[] = [];
			const refTags: GitGraphRowTag[] = [];
			// `head` is per-tip (drives `isCurrentHead` on the branch it decorates); `sawHead` sticks once ANY
			// tip is HEAD so `accumulateRowState` seeds `reachableFromHEAD` even when HEAD isn't the last tip.
			let head = false;
			let sawHead = false;

			if (commit.tips) {
				for (let tip of commit.tips.split(', ')) {
					head = false;
					if (tip === 'refs/stash') continue;

					if (tip.startsWith('tag: ')) {
						const tagName = tip.substring(5);
						refTags.push({
							id: getTagId(repoPath, tagName),
							name: tagName,
							// Not currently used, so don't bother looking it up
							annotated: true,
						});
						continue;
					}

					if (tip.startsWith('HEAD')) {
						head = true;
						sawHead = true;
						if (tip !== 'HEAD') {
							tip = tip.substring(8);
						}
					}

					const remoteName = getRemoteNameFromBranchName(tip);
					if (remoteName) {
						const remote = remoteMap.get(remoteName);
						if (remote != null) {
							const branchName = getBranchNameWithoutRemote(tip);
							if (branchName === 'HEAD') continue;

							refRemoteHeads.push({
								id: getBranchId(repoPath, true, tip),
								name: branchName,
								owner: remote.name,
								url: remote.url,
								current: tip === headRefUpstreamName,
								// `defaultLocalName!` is non-null here because `tip === defaultBranchName` short-circuits when `defaultBranchName` is null.
								isDefault: tip === defaultBranchName && !branchMap.has(defaultLocalName!),
								hostingServiceType: remote.provider?.gkProviderId,
							});
							continue;
						}
					}

					const branch = branchMap.get(tip);
					const branchId = branch?.id ?? getBranchId(repoPath, false, tip);
					// `worktreesByBranch` has the main/default worktree removed, so recover it here.
					const worktree =
						worktreesByBranch?.get(branchId) ??
						(branchId === branchIdOfMainWorktree ? mainWorktree : undefined);
					const worktreeRef =
						worktree != null
							? { id: getWorktreeId(repoPath, worktree.name), path: worktree.path }
							: undefined;
					refHeads.push({
						id: branchId,
						name: tip,
						isCurrentHead: head,
						upstream:
							branch?.upstream != null
								? { name: branch.upstream.name, id: getBranchId(repoPath, true, branch.upstream.name) }
								: undefined,
						worktree: worktreeRef,
						worktreeId: worktree?.isDefault === false ? worktreeRef?.id : undefined,
						isDefault: defaultLocalName != null && tip === defaultLocalName,
					});
				}
			}

			const parents = commit.parents ? commit.parents.split(' ') : [];
			const stash = gitStash?.stashes.get(shaOrRemapped);
			let row: GitGraphRow;
			if (stash != null) {
				row = {
					sha: shaOrRemapped,
					// Always only return the first parent for stashes, as it is a Git implementation for the index and untracked files
					parents: parents.slice(0, 1),
					author: currentUser?.name ?? commit.author,
					email: commit.authorEmail,
					date: Number(ordering === 'author-date' ? commit.authorDate : commit.committerDate) * 1000,
					commitDate: Number(commit.committerDate) * 1000,
					message: (stash.message ?? commit.message).trim(),
					type: 'stash-node',
					heads: refHeads,
					remotes: refRemoteHeads,
					tags: refTags,
					isCurrentUser: true,
				};
				if (stash.stats != null) {
					rowStats.set(shaOrRemapped, {
						files: getChangedFilesCount(stash.stats.files),
						additions: stash.stats.additions,
						deletions: stash.stats.deletions,
					});
				}
			} else {
				const isCurrentUser = isUserMatch(currentUser, commit.author, commit.authorEmail);
				row = {
					sha: shaOrRemapped,
					parents: onlyFollowFirstParent ? parents.slice(0, 1) : parents,
					author: commit.author,
					email: commit.authorEmail,
					date: Number(ordering === 'author-date' ? commit.authorDate : commit.committerDate) * 1000,
					commitDate: Number(commit.committerDate) * 1000,
					message: commit.message.trim(),
					type: parents.length > 1 ? 'merge-node' : 'commit-node',
					heads: refHeads,
					remotes: refRemoteHeads,
					tags: refTags,
					isCurrentUser: isCurrentUser || undefined,
				};
				if (commit.stats != null) {
					rowStats.set(shaOrRemapped, commit.stats);
				}
			}

			return {
				row: row,
				refHeads: refHeads,
				refRemoteHeads: refRemoteHeads,
				refTags: refTags,
				head: sawHead,
				parents: parents,
			};
		}

		// The propagation half of the walk, factored out so the fast path can replay it in memory over reused
		// rows (passing their own `heads`/`remotes`/`tags` as the ref lists and their full `parents`). Mutates
		// the shared reachability/HEAD/downstream accumulators and returns the row's post-propagation
		// reachable-ref map (for interning + flag derivation). `parents` is the FULL parent list (the walk
		// always propagates through every parent, even when the emitted row stores a sliced set). Faithful
		// extraction of the walk's former inline body — must stay byte-identical to it.
		function accumulateRowState(
			sha: string,
			parents: string[],
			refHeads: GitGraphRowHead[],
			refRemoteHeads: GitGraphRowRemoteHead[],
			refTags: GitGraphRowTag[],
			head: boolean,
			isStash: boolean,
		): Map<string, ReachableRef> | undefined {
			if (head) {
				reachableFromHEAD.add(sha);
				headSha ??= sha;
			}
			if (reachableFromHEAD.has(sha)) {
				for (const parent of parents) {
					reachableFromHEAD.add(parent);
				}
			}

			// First-parent rewriteable chain from HEAD (see the field's declaration for the full rationale).
			if (sha === headSha || sha === rewriteableNextSha) {
				if (parents.length === 1) {
					rewriteableFromHEAD.add(sha);
					rewriteableNextSha = parents[0];
				} else {
					rewriteableNextSha = undefined;
				}
			}

			// A remote head with `current` set IS HEAD's tracking upstream tip (see `buildRowFromCommit`).
			if (refRemoteHeads.some(r => r.current)) {
				reachableFromHeadUpstream.add(sha);
			}
			if (reachableFromHeadUpstream.has(sha)) {
				for (const parent of parents) {
					reachableFromHeadUpstream.add(parent);
				}
			}

			// Seed reachability from all ref types on this commit.
			if (refHeads.length > 0 || refRemoteHeads.length > 0 || refTags.length > 0) {
				let refs = reachableRefs.get(sha);
				if (refs == null) {
					refs = new Map<string, ReachableRef>();
					reachableRefs.set(sha, refs);
				}
				for (const h of refHeads) {
					refs.set(`b:${h.name}`, {
						refType: 'branch',
						name: h.name,
						remote: false,
						current: h.isCurrentHead,
					});
				}
				for (const r of refRemoteHeads) {
					const name = `${r.owner}/${r.name}`;
					refs.set(`r:${name}`, { refType: 'branch', name: name, remote: true });
				}
				for (const t of refTags) {
					refs.set(`t:${t.name}`, { refType: 'tag', name: t.name });
				}
			}

			// Propagate reachability to parents (ownership-transfer fast path; see the `reachableRefs`
			// declaration + `finalizeRowReachability` for why the first childless parent may alias the map).
			const currentRefs = reachableRefs.get(sha);
			if (currentRefs != null && currentRefs.size > 0) {
				let transferred = false;
				for (const parent of parents) {
					const parentRefs = reachableRefs.get(parent);
					if (parentRefs == null) {
						if (transferred) {
							reachableRefs.set(parent, new Map(currentRefs));
						} else {
							transferred = true;
							reachableRefs.set(parent, currentRefs);
						}
						continue;
					}

					for (const [key, ref] of currentRefs) {
						if (!parentRefs.has(key)) {
							parentRefs.set(key, ref);
						}
					}
				}
			}

			// Mark any undo-eligible tip that THIS non-stash commit builds on as non-leaf (stash rows excluded).
			if (!isStash) {
				for (const parent of parents) {
					if (undoableTipShas.has(parent)) {
						tipShasWithChildren.add(parent);
					}
				}
			}

			// Downstreams: each branch tip → its upstream name.
			for (const h of refHeads) {
				if (h.upstream?.name != null) {
					let downstreams = downstreamMap.get(h.upstream.name);
					if (downstreams == null) {
						downstreams = [];
						downstreamMap.set(h.upstream.name, downstreams);
					}
					downstreams.push(h.name);
				}
			}

			return reachableRefs.get(sha);
		}

		// Builds the deferred `--shortstat` query for the given rows (only shas the seed doesn't cover),
		// shared by the ordered walk and the fast path. Increments `pendingRowsStatsCount` and resolves it
		// when the background query completes; returns `undefined` when stats aren't requested.
		const buildRowsStatsDeferred = (rows: GitGraphRow[]): GitGraph['rowsStatsDeferred'] => {
			if (!deferStats) return undefined;

			pendingRowsStatsCount++;

			// oxlint-disable-next-line no-async-promise-executor
			const promise = new Promise<void>(async resolve => {
				try {
					// Stats are immutable per sha — only query shas the seed doesn't already cover.
					let missingStdin = '';
					let hasUncoveredStash = false;
					for (const row of rows) {
						if (rowStats.has(row.sha)) continue;

						const seeded = rowsStatsSeed?.get(row.sha);
						if (seeded != null) {
							rowStats.set(row.sha, seeded);
							continue;
						}

						if (row.type === 'stash-node') {
							hasUncoveredStash = true;
						} else {
							missingStdin += `${row.sha}\n`;
						}
					}

					// A stash commit's own shortstat is empty; its stats come from its index/untracked
					// parents, so any uncovered stash pulls in the whole stash stdin (remapped below).
					if (hasUncoveredStash && stdin) {
						missingStdin += stdin;
					}

					// Fully seeded — nothing new to compute, so no git process at all.
					if (!missingStdin) return;

					const statsResult = await this.git.run(
						{ cwd: repoPath, configs: gitConfigsLog, stdin: missingStdin, priority: 'background' },
						'log',
						'--no-walk',
						'--stdin',
						...statsParser.arguments,
						'--',
					);

					if (statsResult.stdout) {
						let statShaOrRemapped;
						for (const stat of statsParser.parse(statsResult.stdout)) {
							statShaOrRemapped = remappedIds.get(stat.sha) ?? stat.sha;

							// Don't overwrite stats already populated for this sha
							if (rowStats.has(statShaOrRemapped)) continue;

							rowStats.set(statShaOrRemapped, stat.stats);
						}
					}
				} finally {
					pendingRowsStatsCount--;
					resolve();
				}
			});

			return { isLoaded: () => pendingRowsStatsCount === 0, promise: promise };
		};

		const args = ['log', ...parser.arguments, `--${ordering}-order`, '--all'];
		if (stdin) {
			args.push('--stdin');
		}
		if (onlyFollowFirstParent) {
			args.push('--first-parent');
		}

		async function getCommitsForGraphCore(
			this: GraphGitSubProvider,
			limit: number,
			sha?: string,
			cursor?: { sha: string; skip: number },
			cancellation?: AbortSignal,
		): Promise<GitGraph> {
			try {
				iterations++;

				// Consume the pre-spawned first walk when available (argv identical by construction:
				// no cursor on the first call); paging/retry calls spawn normally. The pre-spawn's
				// aborter doubles as this call's so the limit-stop kills the right process.
				const prespawned = cursor == null && prespawn != null ? await prespawn : undefined;
				prespawn = undefined;

				const aborter = prespawned != null ? prespawnAborter : new AbortController();
				const onAbort = () => {
					aborter.abort();
				};
				cancellation?.addEventListener('abort', onAbort, { once: true });
				// An ALREADY-aborted signal (e.g. `toAbortSignal` of a cancelled token) never fires listeners
				// added after the fact — without this the walk would run to completion unabortably.
				if (cancellation?.aborted) {
					onAbort();
				}
				using _disposable = createDisposable(() => cancellation?.removeEventListener('abort', onAbort));

				const stream =
					prespawned?.stream ??
					this.git.stream(
						{
							cwd: repoPath,
							configs: gitConfigsLog,
							cancellation: aborter.signal,
							stdin: stdin,
							// Git flushes stdout per record to a pipe, producing thousands of tiny chunks the
							// node side must individually await. Full stdio buffering delivers the same bytes
							// in far fewer, larger chunks — right for this bulk walk (an incremental consumer
							// wanting per-record latency should NOT set this).
							env: { GIT_FLUSH: '0' },
						},
						...args,
						cursor?.skip ? `--skip=${cursor.skip}` : undefined,
						'--',
					);
				using _streamDisposer = createDisposable(() => void stream.return?.(undefined));

				const rows: GitGraphRow[] = [];

				let count = 0;
				let found = false;
				let hasMore = false;

				// Batched parse when available: one awaited yield per stream chunk instead of two
				// promise hops per record — the walk's async-iterator overhead collapses. The
				// with-stats parser (unused here — stats are always deferred) has no batched mode,
				// so wrap its per-record stream into singleton batches to keep one loop shape.
				const batches =
					parser.parseAsyncBatched?.(stream) ??
					(async function* (it) {
						for await (const commit of it) {
							yield [commit];
						}
					})(parser.parseAsync(stream));

				outer: for await (const batch of batches) {
					for (const commit of batch) {
						// Stopping logic (check AFTER processing the commit):
						// - SHA + limit > 0: Find SHA, ensure at least `limit` commits loaded
						// - SHA + limit = 0: Find SHA, stop immediately
						// - No SHA + limit > 0: Load exactly `limit` commits
						// - No SHA + limit = 0: Load everything remaining
						// - SHA + limit > 0 + still unfound past 10× limit: defensive cap so an unreachable
						//   SHA (e.g. a stale merge-base the webview hasn't yet seen invalidated) can't
						//   walk the entire history. `hasMore=true` lets callers retry; the graph-wrapper
						//   side deduplicates re-requests so the cap doesn't loop.
						if (
							(limit && count >= limit && (!sha || found || count >= limit * 10)) ||
							(!limit && sha && found)
						) {
							hasMore = true;
							aborter.abort();
							break outer;
						}

						if (sha && !found && commit.sha === sha) {
							found = true;
						}

						count++;
						if (ids.has(commit.sha)) continue;

						const built = buildRowFromCommit(commit);
						if (built == null) continue; // remapped-stash dedup

						const { row, refHeads, refRemoteHeads, refTags, head, parents } = built;
						const refs = accumulateRowState(
							row.sha,
							parents,
							refHeads,
							refRemoteHeads,
							refTags,
							head,
							row.type === 'stash-node',
						);
						// Transient: the row processor's `+unique` decision reads this; stripped by finalize.
						// Unsorted (the consumer re-sorts after decoding) — order doesn't affect interning.
						row.reachability = refs?.size ? { partial: true, refs: [...refs.values()] } : undefined;
						rowProcessor?.processRow(row, graphCtx!);
						finalizeRowReachability(row, row.sha, refs);
						rows.push(row);
					}
				}

				const startingCursor = cursor?.sha;
				const lastSha = last(ids);
				cursor = lastSha != null ? { sha: lastSha, skip: total - iterations } : undefined;

				const rowsStatsDeferred = buildRowsStatsDeferred(rows);

				return {
					repoPath: repoPath,
					avatars: avatars,
					ids: ids,
					includes: options?.include,
					branches: branchMap,
					remotes: remoteMap,
					downstreams: downstreamMap,
					stashes: gitStash?.stashes,
					worktrees: worktrees,
					worktreesByBranch: worktreesByBranch,
					reachableFromHEAD: reachableFromHEAD,
					rewriteableFromHEAD: rewriteableFromHEAD,
					reachability: reachabilityBuilder.build(),
					refTips: refTips,
					decorationFingerprint: decorationFingerprint,
					shallow: shallow,
					rows: rows,
					id: sha ?? rev,
					rowsStats: rowStats,
					rowsStatsDeferred: rowsStatsDeferred,
					paging: {
						limit: limit === 0 ? count : limit,
						startingCursor: startingCursor,
						hasMore: hasMore,
					},
					more: async (
						limit: number,
						sha?: string,
						cancellation?: AbortSignal,
					): Promise<GitGraph | undefined> =>
						getCommitsForGraphCore.call(this, limit, sha, cursor, cancellation),
				};
			} catch (ex) {
				scope?.error(ex);
				debugger;

				throw ex;
			}
		}

		// R6b incremental head-walk fast path: enumerate ONLY the new commits, stitch the seed's cached tail,
		// and re-derive flags/reachability in memory — instead of re-walking every loaded row. Returns
		// `undefined` (→ full walk below) on any structural change. Reports the outcome via `onIncrementalResult`.
		let incrementalFallbackReason: IncrementalGraphFallbackReason | undefined;
		const tryIncrementalGraph = async (seed: GraphIncrementalSeed): Promise<GitGraph | undefined> => {
			const onResult = options?.onIncrementalResult;
			// Reports a fallback outcome; callers then `return undefined` to take the full walk.
			const fallback = (reason: IncrementalGraphFallbackReason): void => {
				incrementalFallbackReason = reason;
				onResult?.({ path: 'fallback', reason: reason });
			};

			// Cheap gates (no git).
			if (rowProcessor == null || graphCtx == null) {
				fallback('no-row-processor');
				return undefined;
			}
			// The convergence + date-boundary reasoning is only sound for `date` order.
			if (ordering !== 'date' || seed.ordering !== 'date') {
				fallback('ordering-not-date');
				return undefined;
			}

			const seedShas = new Set<string>(seed.rows.map(r => r.sha));

			// A `rev` narrows the walk's find/stop semantics. The host's same-repo rebuild passes a rebuild
			// ANCHOR sha (the loaded window's bottom) to pin that boundary — the anchor is by construction inside
			// the seed, and the stitch + trim below preserve the seed tail, so the fast path can honor it (it
			// grows the window down to the anchor; see the window/limit shape below). A rev NOT in the seed is a
			// real out-of-window target (deep link, reveal) the fast path can't reach → full walk.
			if (rev != null && !seedShas.has(rev)) {
				fallback('rev-outside-seed');
				return undefined;
			}

			// First-parent (now or in the seed) means the emitted rows carry sliced parents the in-memory
			// re-derivation can't expand back to the full set the walk propagates through.
			if (onlyFollowFirstParent || seed.onlyFollowFirstParent) {
				fallback('first-parent');
				return undefined;
			}

			// The ACTUAL current HEAD sha (to seed reachable-from-HEAD and detect a checkout). Distinct from
			// `selectSha`, which resolves the `rev` ANCHOR — not HEAD — when a rev is passed: with no rev
			// `selectSha` already IS the resolved HEAD, otherwise take the current branch tip (also populated for
			// a detached HEAD). The graph `id` still mirrors the full walk's `selectSha ?? rev` (below).
			const currentHeadSha = rev == null ? selectSha : headBranch?.sha;

			// Reuse the prelude's tips (same repo state — nothing mutates between the prelude and here).
			const currentTips = refTips;

			// Shallow-state gate: an un-shallow (or re-shallow) while the graph was closed leaves every branch
			// tip put — so it passes the tip diff below — yet changes what history exists BELOW the loaded window
			// (a stale-false `hasMore` would hide the newly deepened commits). Any change → full walk. Checked
			// against the prelude's already-captured `shallow` (no extra git).
			if ((seed.shallow ?? false) !== shallow) {
				fallback('shallow-changed');
				return undefined;
			}

			// Replace-ref gate: `git replace` (and grafts) rewrite ancestry PRESENTATION globally, so any
			// change to the replace-ref set (`refs/replace/*`) invalidates the cached rows' parent links even when
			// no branch tip moved. An UNCHANGED set (including non-empty) stays fast-path-eligible — the seed rows
			// were built under the same replacement view. Replace refs aren't `isMoveableGraphRef`s (no badge), so
			// the tip diff below skips them; diff them here on their own.
			let seedReplaceCount = 0;
			for (const [refname, oldSha] of seed.tips) {
				if (!refname.startsWith('refs/replace/')) continue;

				seedReplaceCount++;
				// Removed (gone from current) or retargeted (points at a different replacement object).
				if (currentTips.get(refname) !== oldSha) {
					fallback('replace-refs-changed');
					return undefined;
				}
			}
			let currentReplaceCount = 0;
			for (const refname of currentTips.keys()) {
				if (refname.startsWith('refs/replace/')) {
					currentReplaceCount++;
				}
			}
			// Every seed replace ref is present-and-equal in current (checked above); an unequal count means a
			// replace ref was ADDED.
			if (seedReplaceCount !== currentReplaceCount) {
				fallback('replace-refs-changed');
				return undefined;
			}

			// Ref-tip diff gate: deletions + non-fast-forward moves force a full walk.
			// Reused rows whose ref badges / current-HEAD flag changed and must be rebuilt from raw git.
			const affected = new Set<string>();
			const ffPairs: [string, string][] = [];
			// A moved/new REMOTE ref also changes its tracking branches' ahead/behind — baked into those
			// branch pills' serialized contexts (`+ahead`/`+behind` drive Push/Pull menu gating) — while the
			// LOCAL tips stay put; refetch those rows too so a plain fetch corrects them without a full walk.
			const addTrackingBranchRows = (remoteRefname: string): void => {
				if (branches == null || !remoteRefname.startsWith('refs/remotes/')) return;

				const upstreamName = remoteRefname.substring('refs/remotes/'.length);
				for (const b of branches) {
					if (b.upstream?.name === upstreamName && b.sha != null && seedShas.has(b.sha)) {
						affected.add(b.sha);
					}
				}
			};
			for (const [refname, oldSha] of seed.tips) {
				if (!isMoveableGraphRef(refname)) continue;

				const cur = currentTips.get(refname);
				if (cur == null) {
					fallback('ref-deleted');
					return undefined;
				}

				if (cur !== oldSha) {
					ffPairs.push([oldSha, cur]);
					if (seedShas.has(oldSha)) {
						affected.add(oldSha);
					}
					if (seedShas.has(cur)) {
						affected.add(cur);
					}
					addTrackingBranchRows(refname);
				}
			}
			// New refs (present now, absent from the seed) landing on an already-loaded row.
			for (const [refname, cur] of currentTips) {
				if (!isMoveableGraphRef(refname) || seed.tips.has(refname)) continue;

				if (seedShas.has(cur)) {
					affected.add(cur);
				}
				addTrackingBranchRows(refname);
			}
			if (ffPairs.length > 0) {
				// Bounded fan-out: a mass-moved-ref fetch can produce hundreds of pairs — an unbounded
				// `Promise.all` would monopolize (or overflow) the git queue. Small chunks stay well under the
				// queue's slot count, and the first non-fast-forward bails without paying for the rest.
				const ffCheckChunkSize = 4;
				for (let i = 0; i < ffPairs.length; i += ffCheckChunkSize) {
					const results = await Promise.all(
						ffPairs
							.slice(i, i + ffCheckChunkSize)
							.map(([oldSha, newSha]) => this.isFastForward(repoPath, oldSha, newSha, cancellation)),
					);
					if (results.some(ok => !ok)) {
						fallback('ref-non-fast-forward');
						return undefined;
					}
				}
			}

			// HEAD move (checkout) — old/new HEAD rows need their `isCurrentHead` re-derived from raw git. A
			// checkout between two branches sitting on the SAME commit moves no sha yet flips which head carries
			// `isCurrentHead`, so compare the current-head ref NAME too (both are git short refnames; a detached
			// HEAD has an undefined branch name). Either sha or name differing re-derives both endpoints' rows.
			const priorHeadRow = seed.rows.find(r => r.heads?.some(h => h.isCurrentHead));
			const priorHeadSha = priorHeadRow?.sha;
			const priorHeadName = priorHeadRow?.heads?.find(h => h.isCurrentHead)?.name;
			const currentHeadName = headBranch?.name;
			if (priorHeadSha !== currentHeadSha || priorHeadName !== currentHeadName) {
				if (priorHeadSha != null && seedShas.has(priorHeadSha)) {
					affected.add(priorHeadSha);
				}
				if (currentHeadSha != null && seedShas.has(currentHeadSha)) {
					affected.add(currentHeadSha);
				}
			}

			// Stash-set gate: any push/pop/drop changes the injected rows.
			const currentStashShas =
				gitStash?.stashes != null ? new Set<string>(gitStash.stashes.keys()) : new Set<string>();
			const priorStashShas = seed.rows.filter(r => r.type === 'stash-node').map(r => r.sha);
			if (priorStashShas.length !== currentStashShas.size || priorStashShas.some(s => !currentStashShas.has(s))) {
				fallback('stash-changed');
				return undefined;
			}

			// Decoration-metadata gate: rows EMBED metadata derived from side inputs (default branch,
			// upstreams, worktree assignments, remote urls/providers, current user) that can change without
			// moving any ref tip — e.g. `git remote set-head`, `branch --set-upstream-to`, `worktree add`.
			// Reused rows keep their prior decorations (only flags/reachability are re-derived below), so ANY
			// change here must take the full walk that rebuilds them. An absent seed fingerprint (old persisted
			// snapshot) never matches — safe full fallback. Deliberately LAST of the gates so the structural
			// gates above keep their precise reasons (a deleted tracking branch reports `ref-deleted`, not this).
			if (seed.decorationFingerprint !== decorationFingerprint) {
				fallback('metadata-changed');
				return undefined;
			}

			// Per-branch upstream retargets/removals/additions on RETAINED rows: a branch pill embeds its
			// upstream, and a tip-stationary branch's row is reused as-is — so compare every seed-row pill's
			// embedded upstream against the current mapping. Kept OUT of the fingerprint so a NEW tracking
			// branch stays fast (its row is rebuilt via the `affected` refetch; a deleted one is `ref-deleted`).
			for (const r of seed.rows) {
				if (r.heads == null) continue;

				for (const h of r.heads) {
					const currentBranch = branchMap.get(h.name);
					if (currentBranch == null) continue;

					if (h.upstream?.name !== currentBranch.upstream?.name) {
						fallback('metadata-changed');
						return undefined;
					}
				}
			}

			// Enumerate the new commits (reachable now but not from any prior tip) + boundary check.
			// Stashes' rows are already in the seed, so their shas join the EXCLUSIONS (passing them via
			// `--all` would re-emit them as "new"). The exclusions are fed as `^sha` lines over stdin, NOT
			// argv — a repo can carry more distinct ref tips (tags, PR refs) than a command line holds
			// (Windows caps ~32K chars), and stdin is unbounded.
			const notShas = new Set<string>(seed.tips.values());
			for (const s of currentStashShas) {
				notShas.add(s);
			}
			let exclusionsStdin = '';
			for (const s of notShas) {
				exclusionsStdin += `^${s}\n`;
			}
			const enumResult = await this.git.run(
				{ cwd: repoPath, configs: gitConfigsLog, cancellation: cancellation, stdin: exclusionsStdin },
				'log',
				...parser.arguments,
				'--date-order',
				'--all',
				'--stdin',
				'--',
			);
			const newCommits = [...parser.parse(enumResult.stdout)];

			// Stitch soundness: the result must equal [...new, ...seed]. That holds iff every new commit is
			// strictly newer than the seam (the max date across the seed window) — an equal/older date could
			// interleave under `--date-order`, so bail. Checked on raw dates BEFORE any mutation.
			let maxSeedDate = Number.NEGATIVE_INFINITY;
			for (const r of seed.rows) {
				if (r.date > maxSeedDate) {
					maxSeedDate = r.date;
				}
			}
			for (const c of newCommits) {
				if (Number(c.committerDate) * 1000 <= maxSeedDate) {
					fallback('date-boundary');
					return undefined;
				}
			}

			// Window/limit shape.
			const stitchedSize = newCommits.length + seed.rows.length;
			const seedHasMore = seed.hasMore === true;
			const noLimit = defaultLimit === 0;
			// The rev anchor (a seed sha) bounds the walk's BOTTOM: the full walk with `sha=rev` grows its window
			// down to (and INCLUDING) rev before honoring the limit — and with no limit it stops the instant it
			// finds rev — so the anchor row survives the trim even when `limit` alone would cut above it. Its index
			// in the assembled window `[new…, seed…]` (new commits never dedup, so `newRows.length` equals
			// `newCommits.length`): `newCommits.length + <its index in seed.rows>`.
			const revWindowIndex = rev != null ? newCommits.length + seed.rows.findIndex(r => r.sha === rev) : -1;
			// Rows the walk targets: `defaultLimit`, raised to at least include the rev anchor (with no limit + rev,
			// exactly `revWindowIndex + 1`, since the walk stops on finding rev).
			const targetRows =
				rev != null
					? noLimit
						? revWindowIndex + 1
						: Math.max(defaultLimit, revWindowIndex + 1)
					: defaultLimit;
			// The fast path can only serve rows the seed carries; if more is wanted than it holds AND there was
			// more below it, git is needed for the gap → full walk. (No rev + no limit wants everything below.)
			const wantsBelowWindow = rev != null ? targetRows > stitchedSize : noLimit || defaultLimit > stitchedSize;
			if (wantsBelowWindow && seedHasMore) {
				fallback('limit-exceeds-seed');
				return undefined;
			}

			const trimTo =
				rev != null
					? Math.min(targetRows, stitchedSize)
					: noLimit
						? stitchedSize
						: Math.min(defaultLimit, stitchedSize);
			const hasMore = trimTo < stitchedSize || seedHasMore;
			// Stashes present in the window make the `more()` skip math (records vs unique ids) ambiguous —
			// only take the fast path when nothing pages below.
			if (currentStashShas.size > 0 && hasMore) {
				fallback('stash-window-conflict');
				return undefined;
			}

			// Commit to the fast path — mutations begin here (all fallbacks are above).
			const newRows: GitGraphRow[] = [];
			for (const c of newCommits) {
				const built = buildRowFromCommit(c);
				if (built != null) {
					newRows.push(built.row);
				}
			}

			// Rebuild the affected reused rows from raw git (bounded `--no-walk`) so their ref badges + emojified
			// message + current-HEAD flag are exactly what a full walk would produce (git owns %D ordering).
			const refetched = new Map<string, GitGraphRow>();
			if (affected.size > 0) {
				// SHAs over stdin, not argv — a mass-moved-ref fetch can put hundreds of retained rows in
				// `affected`, past what a command line holds (see the enumeration above).
				const refetchResult = await this.git.run(
					{ cwd: repoPath, configs: gitConfigsLog, cancellation: cancellation, stdin: join(affected, '\n') },
					'log',
					...parser.arguments,
					'--no-walk',
					'--stdin',
					'--',
				);
				for (const c of parser.parse(refetchResult.stdout)) {
					const built = buildRowFromCommit(c);
					if (built != null) {
						refetched.set(built.row.sha, built.row);
					}
				}
			}
			const freshShas = new Set<string>([...newRows.map(r => r.sha), ...refetched.keys()]);

			// Assemble [new…, reused/refetched…] and trim to the requested window (new commits push the
			// bottom rows out — exactly what a full walk at this limit does).
			const windowRows: GitGraphRow[] = [...newRows];
			for (const r of seed.rows) {
				windowRows.push(refetched.get(r.sha) ?? r);
			}
			windowRows.length = Math.min(windowRows.length, trimTo);

			// Building the fresh rows above populated `ids`/`total` (via `buildRowFromCommit`); reset and rebuild
			// them from the FINAL trimmed window so `ids`/`total`/the reachability boundary match a full walk
			// exactly (this is what makes `more()` continue identically).
			ids.clear();
			total = 0;
			for (const row of windowRows) {
				ids.add(row.sha);
				total++;
				const refs = accumulateRowState(
					row.sha,
					row.parents,
					row.heads ?? [],
					row.remotes ?? [],
					row.tags ?? [],
					row.sha === currentHeadSha,
					row.type === 'stash-node',
				);
				if (freshShas.has(row.sha)) {
					// Fresh rows are raw — run the full processor (contexts, emojify, avatar). Reused rows keep
					// their already-processed contexts/message; only their flags (below) are recomputed.
					row.reachability = refs?.size ? { partial: true, refs: [...refs.values()] } : undefined;
					rowProcessor.processRow(row, graphCtx);
				}
				// Authoritative flags for every commit row (membership can shift on reused rows too — e.g. a new
				// interior branch flips `+unique`). Stash rows carry none.
				if (row.type !== 'stash-node') {
					(row.contexts ??= {}).flags = computeGraphRowContextFlags(row.sha, refs?.values(), graphCtx);
				}
				finalizeRowReachability(row, row.sha, refs);
			}

			// Reconstruct the walk's first-call cursor so `more()` (which re-spawns git from `--skip`) continues
			// byte-identically off the trimmed window.
			iterations = 1;
			const lastSha = last(ids);
			const cursor = lastSha != null ? { sha: lastSha, skip: total - iterations } : undefined;
			const rowsStatsDeferred = buildRowsStatsDeferred(windowRows);

			onResult?.({ path: 'fast', added: newRows.length });
			return {
				repoPath: repoPath,
				avatars: avatars,
				ids: ids,
				includes: options?.include,
				branches: branchMap,
				remotes: remoteMap,
				downstreams: downstreamMap,
				stashes: gitStash?.stashes,
				worktrees: worktrees,
				worktreesByBranch: worktreesByBranch,
				reachableFromHEAD: reachableFromHEAD,
				rewriteableFromHEAD: rewriteableFromHEAD,
				reachability: reachabilityBuilder.build(),
				refTips: refTips,
				decorationFingerprint: decorationFingerprint,
				shallow: shallow,
				rows: windowRows,
				// Mirror the full walk's `id` (`sha ?? rev`, sha = the resolved rev-or-HEAD) — NOT the actual HEAD,
				// which `currentHeadSha` now tracks separately when a rev anchor is passed.
				id: selectSha ?? rev,
				rowsStats: rowStats,
				rowsStatsDeferred: rowsStatsDeferred,
				paging: {
					limit: noLimit ? total : defaultLimit,
					startingCursor: undefined,
					hasMore: hasMore,
				},
				more: async (limit: number, sha?: string, cancellation?: AbortSignal): Promise<GitGraph | undefined> =>
					getCommitsForGraphCore.call(this, limit, sha, cursor, cancellation),
			};
		};

		if (options?.incrementalSeed != null) {
			let fast: GitGraph | undefined;
			try {
				fast = await tryIncrementalGraph(options.incrementalSeed);
			} catch (ex) {
				// The fast path must never fail where the full walk it accelerates would succeed — its git
				// operations have failure modes the `--all` walk doesn't (per-tip `--not` argv on huge ref
				// sets, queue-depth overflow fanning out FF checks, transient git errors). Cancellation
				// still propagates; anything else degrades to the full walk below.
				if (isCancellationError(ex) || cancellation?.aborted) throw ex;

				// The fast path may have died AFTER its mutation barrier (the affected-row refetch, or the
				// row processor) with the walk accumulators partially populated — a full walk over polluted
				// `ids` would silently DROP those rows (its loop dedups on `ids.has`). Reset every closure
				// accumulator to its pristine pre-walk state; the seeded reachability builder is append-only
				// and tolerates orphaned interns by design, and mutated reused-row objects are superseded by
				// the full walk's fresh rows.
				ids.clear();
				total = 0;
				iterations = 0;
				rowStats.clear();
				avatars.clear();
				reachableFromHEAD.clear();
				rewriteableFromHEAD.clear();
				reachableFromHeadUpstream.clear();
				reachableRefs.clear();
				tipShasWithChildren.clear();
				downstreamMap.clear();
				headSha = undefined;
				rewriteableNextSha = undefined;

				scope?.warn(`incremental graph walk failed; falling back to full walk; ${String(ex)}`);
				incrementalFallbackReason = 'error';
				options.onIncrementalResult?.({ path: 'fallback', reason: 'error' });
			}
			if (fast != null) {
				return fast;
			}

			// Parent-rewriting fallbacks change boundary commits' true diffs — an unshallowed parent or a
			// replace-ref retarget makes previously-computed per-sha stats stale, so the fallback walk must
			// recompute them instead of carrying the prior generation's values forward. An `error` fallback
			// recomputes too: the throw may have preceded the replace-ref/shallow gates, so staleness can't
			// be ruled out.
			if (
				incrementalFallbackReason === 'shallow-changed' ||
				incrementalFallbackReason === 'replace-refs-changed' ||
				incrementalFallbackReason === 'error'
			) {
				rowsStatsSeed = undefined;
			}
		}

		let graph = await getCommitsForGraphCore.call(this, defaultLimit, selectSha, undefined, cancellation);

		// Spurious-empty guard: the repo has branches (so `git log --all` should yield commits) yet the
		// log returned no rows. That's an inconsistent result — almost always a transient ref-read race
		// while a concurrent git operation rewrites refs/packed-refs — not a genuinely empty repo.
		// Returning it would flash "No commits" in the graph. Retry once (transient glitches clear within
		// ms). A truly empty repo has no branches and is left untouched.
		if (graph.rows.length === 0 && branches?.length && !cancellation?.aborted) {
			scope?.warn(`graph returned 0 rows but repo has ${branches.length} branches; retrying`);
			graph = await getCommitsForGraphCore.call(this, defaultLimit, selectSha, undefined, cancellation);
		}

		return graph;
	}

	@debug({
		args: (repoPath, s, o) => ({
			repoPath: repoPath,
			search: `[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}${s.matchWholeWord ? 'W' : ''}]: ${
				s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query
			}`,
			options: `limit=${o?.limit}, ordering=${o?.ordering}`,
		}),
	})
	async *searchGraph(
		repoPath: string,
		search: SearchQuery,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
		cancellation?: AbortSignal,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
		return yield* this.searchGraphCore(repoPath, search, undefined, undefined, options, cancellation);
	}

	@debug({
		args: (repoPath, c, r, o) => ({
			repoPath: repoPath,
			cursor: `[${c.search.matchAll ? 'A' : ''}${c.search.matchCase ? 'C' : ''}${c.search.matchRegex ? 'R' : ''}${c.search.matchWholeWord ? 'W' : ''}]: ${
				c.search.query.length > 500 ? `${c.search.query.substring(0, 500)}...` : c.search.query
			} (continue)`,
			existingResults: `results=${r.size}`,
			options: `limit=${o?.limit}`,
		}),
	})
	async *continueSearchGraph(
		repoPath: string,
		cursor: GitGraphSearchCursor,
		existingResults: GitGraphSearchResults,
		options?: { limit?: number },
		cancellation?: AbortSignal,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
		return yield* this.searchGraphCore(repoPath, cursor.search, cursor, existingResults, options, cancellation);
	}

	private async *searchGraphCore(
		repoPath: string,
		search: SearchQuery,
		cursor: GitGraphSearchCursor | undefined,
		existingResults: GitGraphSearchResults | undefined,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
		cancellation?: AbortSignal,
	): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
		search = { matchAll: false, matchCase: false, matchRegex: true, matchWholeWord: false, ...search };

		const comparisonKey = getSearchQueryComparisonKey(search);
		try {
			const currentUser = search.query.includes('@me')
				? await this.provider.config.getCurrentUser(repoPath)
				: undefined;

			const { args: searchArgs, files, shas, filters } = parseSearchQueryGitCommand(search, currentUser);

			const tipsOnly = filters.type === 'tip';
			const parser = filters.files
				? getShaAndDatesWithFilesLogParser(tipsOnly)
				: getShaAndDatesLogParser(tipsOnly);

			const similarityThreshold = this.context.config?.commits.similarityThreshold ?? undefined;
			const args = [
				'log',
				...parser.arguments,
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
				'--use-mailmap',
			];

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;
			let remappedIds: Map<string, string>;

			let resolvedShas: Set<string> | undefined;
			if (shas?.size) {
				resolvedShas = await this.provider.revision.resolveShas(repoPath, shas, cancellation);
				// Never throw on cancellation here: the outer catch wraps non-GitSearchError into
				// GitSearchError, which surfaces as a false "Invalid search pattern". Return instead.
				if (cancellation?.aborted) {
					return {
						repoPath: repoPath,
						query: search,
						queryFilters: filters,
						comparisonKey: comparisonKey,
						results: existingResults ?? new Map<string, GitGraphSearchResultData>(),
						hasMore: true,
					};
				}
				// Short SHA(s) matched no commit: return empty (empty stdin to `--no-walk --stdin`
				// would return HEAD, so we must not fall through to git).
				if (!resolvedShas.size) {
					return {
						repoPath: repoPath,
						query: search,
						queryFilters: filters,
						comparisonKey: comparisonKey,
						results: existingResults ?? new Map<string, GitGraphSearchResultData>(),
						hasMore: false,
					};
				}
			}

			if (resolvedShas?.size) {
				stdin = join(resolvedShas, '\n');
				args.push('--no-walk');

				remappedIds = new Map();
			} else if (!filters.refs) {
				// Don't include stashes when using ref: filter, as they would add unrelated commits
				// There *HAS* to be a better way to get git log to return stashes, but this is the best we've found
				({ stdin, stashes, remappedIds } = convertStashesToStdin(
					await this.provider.stash?.getStash(repoPath, { includeFiles: false }, cancellation),
				));
			} else {
				remappedIds = new Map();
			}

			if (stdin) {
				args.push('--stdin');
			}

			const limit = options?.limit ?? this.context.config?.graph?.maxSearchItems ?? 0;
			const ordering = options?.ordering ?? this.context.config?.commits.ordering ?? undefined;
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			// Add the search args, but skip any shas (as they are already included in the stdin)
			for (const arg of searchArgs) {
				if (shas?.has(arg) || args.includes(arg)) continue;

				args.push(arg);
			}

			const results: GitGraphSearchResults = existingResults ?? new Map<string, GitGraphSearchResultData>();

			// Use state from cursor, if provided
			const cursorState = cursor?.state != null && typeof cursor.state === 'object' ? cursor.state : undefined;
			let iterations = cursorState?.iterations ?? 0;
			let totalSeen = cursorState?.totalSeen ?? 0;
			let skipCursor = cursorState ? { sha: cursorState.sha, skip: cursorState.skip } : undefined;

			let count = 0;
			try {
				iterations++;

				const aborter = new AbortController();
				const onAbort = () => {
					aborter.abort();
				};
				cancellation?.addEventListener('abort', onAbort, { once: true });
				// An ALREADY-aborted signal (e.g. `toAbortSignal` of a cancelled token) never fires listeners
				// added after the fact — without this the walk would run to completion unabortably.
				if (cancellation?.aborted) {
					onAbort();
				}
				using _disposable = createDisposable(() => cancellation?.removeEventListener('abort', onAbort));

				const stream = this.git.stream(
					{
						cwd: repoPath,
						cancellation: aborter.signal,
						configs: ['-C', repoPath, ...gitConfigsLog],
						stdin: stdin,
					},
					...args,
					skipCursor?.skip ? `--skip=${skipCursor.skip}` : undefined,
					'--',
					...files,
				);
				using _streamDisposer = createDisposable(() => void stream.return?.(undefined));
				let hasMore = false;
				let sha;
				const stashesOnly = filters.type === 'stash';

				// Progressive results support - time-based batching for consistent UI updates
				const batch: [string, GitGraphSearchResultData][] = [];
				let lastProgressTime = Date.now();

				for await (const r of parser.parseAsync(stream)) {
					// Check for cancellation early in each iteration
					if (cancellation?.aborted) {
						// When paused/cancelled, assume there are more results
						hasMore = true;
						break;
					}

					count++;
					if (limit && count > limit) {
						hasMore = true;

						aborter.abort();
						break;
					}

					sha = remappedIds.get(r.sha) ?? r.sha;
					if (results.has(sha) || (stashesOnly && !stashes?.has(sha)) || (tipsOnly && !r.tips)) {
						continue;
					}

					const resultData: GitGraphSearchResultData = {
						i: results.size,
						date: Number(options?.ordering === 'author-date' ? r.authorDate : r.committerDate) * 1000,
						files: r.files,
					};
					results.set(sha, resultData);
					batch.push([sha, resultData]);

					// Send progress updates with incremental results
					const timeSinceLastProgress = Date.now() - lastProgressTime;

					// Send batch when enough time has passed and we have new results
					const shouldSendBatch =
						timeSinceLastProgress >= progressiveSearchResultsBatchTimeMs && batch.length > 0;

					if (shouldSendBatch) {
						// Send only the NEW results since last batch (incremental)
						yield {
							repoPath: repoPath,
							query: search,
							queryFilters: filters,
							comparisonKey: comparisonKey,
							results: new Map(batch),
							runningTotal: results.size,
							hasMore: true,
						};

						batch.length = 0;
						lastProgressTime = Date.now();
					}
				}

				// Send final progress update if there are remaining results
				if (batch.length) {
					yield {
						repoPath: repoPath,
						query: search,
						queryFilters: filters,
						comparisonKey: comparisonKey,
						results: new Map(batch),
						runningTotal: results.size,
						hasMore: hasMore,
					};
				}

				totalSeen += count;
				const lastSha = last(results)?.[0];
				skipCursor = lastSha != null ? { sha: lastSha, skip: totalSeen - iterations } : undefined;

				return {
					repoPath: repoPath,
					query: search,
					queryFilters: filters,
					comparisonKey: comparisonKey,
					results: results,
					hasMore: hasMore,
					paging:
						limit || hasMore
							? {
									limit: limit || count,
									cursor:
										hasMore && skipCursor
											? {
													search: search,
													state: {
														iterations: iterations,
														totalSeen: totalSeen,
														sha: skipCursor.sha,
														skip: skipCursor.skip,
													},
												}
											: undefined,
								}
							: undefined,
				};
			} catch (ex) {
				if (isCancellationError(ex) || cancellation?.aborted) {
					// When cancelled, preserve cursor so search can be resumed
					// Update totalSeen with the count from this iteration
					totalSeen += count;
					const lastSha = last(results)?.[0];
					const skipCursor = lastSha != null ? { sha: lastSha, skip: totalSeen - iterations } : undefined;

					return {
						repoPath: repoPath,
						query: search,
						queryFilters: filters,
						comparisonKey: comparisonKey,
						results: results,
						hasMore: true, // Assume there are more results since we were cancelled mid-search
						paging:
							limit || skipCursor
								? {
										limit: limit || count,
										cursor: skipCursor
											? {
													search: search,
													state: {
														iterations: iterations,
														totalSeen: totalSeen,
														sha: skipCursor.sha,
														skip: skipCursor.skip,
													},
												}
											: undefined,
									}
								: undefined,
					};
				}

				throw new GitSearchError(ex);
			}
		} catch (ex) {
			if (ex instanceof GitSearchError) throw ex;

			throw new GitSearchError(ex);
		}
	}
}

/**
 * CLI-backed {@link GitGraphSession}: a stateful facade over {@link GraphGitSubProvider.getGraph}. It
 * owns the canonical accumulated window and builds the R6b incremental seed internally (from the window,
 * the prior walk's tips/reachability/stats, and the walk shape), so the host no longer mirrors loaded
 * rows, stamps ref tips, or hand-assembles a seed. Behavior-neutral: `refresh`/`more` reproduce exactly
 * what the host's `getState` seed construction + `setGraph` mirror maintenance + write-once avatar merge
 * did.
 */
class GraphSession implements GitGraphSession {
	// Assigned by `initialize` before the session is handed out; never read before then.
	private _current!: GitGraph;
	private _window: readonly GitGraphRow[] = [];
	// The walk shape (`ordering|onlyFollowFirstParent`) the current window was produced under — the
	// incremental seed is only valid when the NEXT walk uses the SAME shape (a graph object doesn't
	// record its shape, so it's tracked here). Undefined until the first walk lands.
	private _buildShape: string | undefined;

	constructor(
		private readonly provider: GraphGitSubProvider,
		readonly repoPath: string,
		private readonly rowProcessor: GraphRowProcessor | undefined,
		private readonly getWalkShape: () => {
			ordering: 'date' | 'author-date' | 'topo';
			onlyFollowFirstParent: boolean;
		},
	) {}

	get window(): readonly GitGraphRow[] {
		return this._window;
	}

	get current(): GitGraph {
		return this._current;
	}

	/** First walk — no seed (nothing accumulated yet), equivalent to a plain `getGraph`. */
	async initialize(
		options?: { rev?: string; limit?: number; include?: { stats?: boolean } },
		cancellation?: AbortSignal,
	): Promise<void> {
		const shape = this.getWalkShape();
		const graph = await this.provider.getGraph(
			this.repoPath,
			options?.rev,
			{ include: options?.include, limit: options?.limit, rowProcessor: this.rowProcessor },
			cancellation,
		);
		this.applyRebuild(graph, shape);
	}

	/**
	 * R7c restart persistence. Reconstruct the prior generation from a persisted snapshot as an R6 seed
	 * WITHOUT any git (its window/tips/reachability/stats become this session's prior `current`/`window`/
	 * `buildShape`), then IMMEDIATELY {@link refresh} to current truth — the enumeration + tip/FF/stash gates
	 * reconcile a stale snapshot (fast when unchanged, a full walk on any structural change). The session
	 * handed back is ALWAYS post-refresh; the raw snapshot is never surfaced. The caller has already validated
	 * the snapshot structurally. Returns the refresh outcome so the caller can report the restore result.
	 */
	async restore(
		snapshot: GitGraphSessionSnapshot,
		options?: { rev?: string; limit?: number; include?: { stats?: boolean } },
		cancellation?: AbortSignal,
	): Promise<GitGraphSessionRefreshResult> {
		this._window = snapshot.rows;
		this._buildShape = snapshot.buildShape;
		this._current = buildRestoredGraph(snapshot);

		// Anchor the re-walk on the window's BOTTOM commit so it spans the whole restored window (the host's
		// rebuild-anchor discipline), matching to at least the current limit so a since-grown repo still fills a
		// full page. Stash rows aren't real revs, so skip them when picking the anchor.
		let anchor: string | undefined;
		for (let i = snapshot.rows.length - 1; i >= 0; i--) {
			const type = snapshot.rows[i].type;
			if (type === 'commit-node' || type === 'merge-node') {
				anchor = snapshot.rows[i].sha;
				break;
			}
		}
		const limit = Math.max(snapshot.rows.length, options?.limit ?? 0);

		return this.refresh({ rev: anchor, limit: limit, include: options?.include }, cancellation);
	}

	async refresh(
		options?: GitGraphSessionRefreshOptions,
		cancellation?: AbortSignal,
	): Promise<GitGraphSessionRefreshResult> {
		const shape = this.getWalkShape();
		const buildShape = buildShapeKey(shape);
		const prior = this._current;

		// Incremental head-walk seed: the FULL accumulated window + the prior walk's tips/reachability/stats,
		// gated on an unchanged walk shape (a first-parent/ordering change reshapes every row's parents/order,
		// so the cached rows can't be reused). Mirrors the host's former `incrementalSeed` construction and
		// `_graphBuildShape` gate — the session owns the shape, so it can't be handed a lying seed. The provider
		// still re-validates ordering/first-parent internally and falls back on any structural change.
		const incrementalSeed: GraphIncrementalSeed | undefined =
			options?.rebuild !== true && prior.refTips != null && this._buildShape === buildShape
				? {
						rows: this._window,
						tips: prior.refTips,
						ordering: shape.ordering,
						reachability: prior.reachability,
						rowsStats: prior.rowsStats,
						hasMore: prior.paging?.hasMore ?? false,
						onlyFollowFirstParent: shape.onlyFollowFirstParent,
						shallow: prior.shallow,
						decorationFingerprint: prior.decorationFingerprint,
					}
				: undefined;

		let outcome: IncrementalGraphOutcome | undefined;
		let graph = await this.provider.getGraph(
			this.repoPath,
			options?.rev,
			{
				include: options?.include,
				limit: options?.limit,
				rowProcessor: this.rowProcessor,
				// Same-repo rebuild: continue the prior reachability generation (stable indices for retained
				// rows) and reuse immutable per-sha stats — exactly the host's former same-repo seeds.
				reachabilitySeed: prior.reachability,
				rowsStatsSeed: prior.rowsStats,
				incrementalSeed: incrementalSeed,
				onIncrementalResult: o => {
					outcome = o;
				},
			},
			cancellation,
		);

		// Host-serialization backstop: the host serializes refresh against more() per repo. Should a more() still
		// land mid-refresh (`_current` swapped out from under this await), the rebuild predates that appended page
		// — refresh carries newer repo truth so we still apply it, but when the accumulated window outran the
		// rebuild the dropped page must re-page, not vanish. `paging.hasMore` is readonly, so re-wrap it truthful.
		if (this._current !== prior && graph.paging != null && this._window.length > graph.rows.length) {
			graph = { ...graph, paging: { ...graph.paging, hasMore: true } };
		}

		// Write-once cross-generation avatar merge (formerly in host `setGraph`): carry prior URLs forward
		// into the fresh graph's map without overwriting its own entries.
		mergeAvatarsForward(prior.avatars, graph.avatars);
		this.applyRebuild(graph, shape);

		// The full path (seeded fallback or unseeded full walk) re-derives everything → every channel changed.
		// The fast path derives each channel honestly from what it actually touched — a false negative is data
		// loss, so a channel is `false` only when it PROVABLY didn't change (never merely when uncertain).
		if (outcome?.path === 'fast') {
			const changed: GitGraphSessionChangedChannels = {
				// A head-walk always reshapes the window; the publisher's ledger diff derives the precise splice
				// (including reused-row flag / reachability-index changes the re-derivation makes in place).
				rows: true,
				// The builder continues the prior generation (same id); a grown table means new dict/set entries
				// to append. A per-row index that re-points to an EXISTING set rides the rows channel, not this.
				reachability: reachabilityTableChanged(prior.reachability, graph.reachability),
				// Only NEW commit shas need stats (reused rows carry seeded, already-shipped stats), and only when
				// stats were requested at all. The host's deferred-completion hook re-marks this channel when the
				// background query lands, so this is just the synchronous signal.
				rowsStats: graph.includes?.stats === true && (outcome.added ?? 0) > 0,
				// Avatars are write-once merged across generations, so the map only grows — a larger size means
				// new emails. Value replacements (avatar proxy) ride the host's dedicated avatar path, not this.
				avatars: graph.avatars.size !== prior.avatars.size,
				// The fast path rebuilds the downstreams map from all rows; compare it against the prior.
				downstreams: downstreamsChanged(prior.downstreams, graph.downstreams),
			};
			return { path: 'fast', added: outcome.added, changed: changed };
		}

		const changed: GitGraphSessionChangedChannels = {
			rows: true,
			reachability: true,
			rowsStats: true,
			// Ties to the rowsStatsSeed drop above: these fallbacks recompute stats for shas already shipped.
			rowsStatsRecomputed:
				outcome?.path === 'fallback' &&
				(outcome.reason === 'shallow-changed' || outcome.reason === 'replace-refs-changed'),
			avatars: true,
			downstreams: true,
		};
		// A seeded fallback carries its reason; an unseeded full walk (no `onIncrementalResult` fired) carries none.
		if (outcome?.path === 'fallback') return { path: 'full', reason: outcome.reason, changed: changed };
		return { path: 'full', changed: changed };
	}

	async more(limit?: number, targetId?: string, cancellation?: AbortSignal): Promise<boolean> {
		const prior = this._current;
		const updated = await prior.more?.(limit ?? 0, targetId, cancellation);
		// A refresh swapped `current` out from under the page walk (stale generation) — benign; drop it and
		// the host re-requests on the next scroll.
		if (this._current !== prior) return false;
		// A live page walk yielding nothing is unexpected (hasMore said otherwise).
		if (updated == null) {
			debugger;
			return false;
		}

		mergeAvatarsForward(prior.avatars, updated.avatars);
		this.applyPage(updated);
		return true;
	}

	serialize(): GitGraphSessionSnapshot | undefined {
		const current = this._current;
		// Nothing worth persisting: no window yet, no build shape recorded, or no ref tips (the restore's
		// tip-diff gate has nothing to diff — never true for the CLI provider, but guards a defensive future).
		if (this._window.length === 0 || this._buildShape == null || current?.refTips == null) return undefined;

		const [ordering, onlyFollowFirstParent] = this._buildShape.split('|');

		// Cap the persisted window to a bounded top slice; a longer window persists its top with `hasMore`
		// forced true (restore behaves as a shorter loaded window — the bottom re-pages on demand). Slicing
		// makes a new array of the SAME row objects — no mutation of the live window.
		const capped = this._window.length > maxPersistedGraphRows;
		const rows = capped ? this._window.slice(0, maxPersistedGraphRows) : (this._window as GitGraphRow[]);
		const hasMore = capped || (current.paging?.hasMore ?? false);

		// Stats are immutable per sha; when capped, trim to the persisted shas (entries for dropped rows are
		// dead weight). The reachability table is kept whole even when capped — it's proportional to distinct
		// ref-sets (small), the persisted rows' indices stay valid, and extra sets are harmless on decode.
		let rowsStats: [string, GitGraphRowStats][] | undefined;
		if (current.includes?.stats === true && current.rowsStats != null && current.rowsStats.size > 0) {
			const shas = capped ? new Set(rows.map(r => r.sha)) : undefined;
			rowsStats = [];
			for (const [sha, stats] of current.rowsStats) {
				if (shas != null && !shas.has(sha)) continue;

				rowsStats.push([sha, stats]);
			}
		}

		return {
			v: graphSessionSnapshotVersion,
			repoPath: this.repoPath,
			buildShape: this._buildShape,
			ordering: ordering as 'date' | 'author-date' | 'topo',
			onlyFollowFirstParent: onlyFollowFirstParent === 'true',
			rows: rows,
			refTips: [...current.refTips],
			decorationFingerprint: current.decorationFingerprint,
			reachability: current.reachability,
			rowsStats: rowsStats,
			downstreams: Array.from(current.downstreams, ([k, v]): [string, string[]] => [k, [...v]]),
			hasMore: hasMore,
			includesStats: current.includes?.stats === true,
			shallow: current.shallow ?? false,
		};
	}

	dispose(): void {
		// No-op — the window lives entirely in memory. R7c restart persistence is host-driven: the host
		// serializes this session (debounced + on its own dispose) and owns the storage IO.
	}

	/** A cursor-less rebuild (full walk / fast path) IS the full window. */
	private applyRebuild(graph: GitGraph, shape: { ordering: string; onlyFollowFirstParent: boolean }): void {
		this._current = graph;
		this._window = graph.rows;
		this._buildShape = buildShapeKey(shape);
	}

	/** A page-append: keep the window up to the cursor and append the page (the reducer's cursor-anchored
	 *  concatenation); the walk shape is unchanged (same generation). */
	private applyPage(page: GitGraph): void {
		this._current = page;
		const startingCursor = page.paging?.startingCursor;
		// A page always carries a cursor; a cursor-less page (shouldn't happen) is treated as a full window,
		// matching the host mirror's former fallback.
		this._window = startingCursor == null ? page.rows : appendRowsAtCursor(this._window, startingCursor, page.rows);
	}
}
