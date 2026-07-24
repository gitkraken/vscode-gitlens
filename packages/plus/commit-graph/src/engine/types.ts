/**
 * Core types for the commit-graph engine — pure data shapes, no rendering framework.
 */

export type Sha = string;

/**
 * The semantic class of a node in the graph. `workdir` is the synthetic WIP row at the top.
 */
export type CommitKind = 'commit' | 'merge' | 'stash' | 'workdir';

/**
 * Edges carry a slightly wider type than commits: `synthetic-edge` represents a collapsed
 * ancestor link injected by scoped-graph mode when the real parent chain is filtered out.
 */
export type EdgeKind = CommitKind | 'synthetic-edge';

/**
 * A single parent link emitted by the lane/edge algorithm. The renderer uses the kind to
 * pick stroke style (solid vs dashed vs wavy).
 */
export interface Edge {
	parentSha: Sha;
	kind: EdgeKind;
	/**
	 * True when this link jumps over commits hidden by a collapsed lane (its real direct parent was
	 * dropped and remapped to the nearest visible ancestor). Distinct from `synthetic-edge` (which is
	 * for UNLOADED ancestors): these commits are loaded but folded away. The renderer draws it dashed.
	 * Set on the starting edge and carried forward as the lane passes through / ends on later rows.
	 */
	spansHidden?: boolean;
}

/**
 * Map of column → single edge. Used for the "starting edges by column" intermediate.
 */
export type EdgeByColumn = Record<number, Edge>;

/**
 * The three states an edge can be in within a row's gutter:
 *   - `starting` — emitted from the commit in this row down toward a parent below
 *   - `passThrough` — a lane that passes vertically through this row (commit is neither here nor here's target)
 *   - `ending` — a lane that terminates at a commit rendered in this row
 */
export interface RowEdge {
	starting?: Edge;
	passThrough?: Edge;
	ending?: Edge;
}

/**
 * For each column (lane index) in this row, the set of edge states present.
 */
export type RowEdges = Record<number, RowEdge>;

/**
 * Minimum commit shape the engine needs. Everything else (author, message, refs, date) is
 * metadata the renderer will carry on its own row model — the engine stays decoupled.
 */
export interface GraphRow {
	sha: Sha;
	parents: Sha[];
	kind: CommitKind;
	/**
	 * Optional commit timestamp (Unix ms — NOT a Date) used ONLY for the stash-vs-commit lane tie-break
	 * in layout: a newer commit reclaims a contended lane from an older stash. Absent/0 when unknown, in
	 * which case the engine skips the tie-break and lane order falls back to row order.
	 */
	date?: number;
}

/**
 * A GraphRow after the engine has placed it in a lane and computed its edges.
 */
export interface ProcessedGraphRow extends GraphRow {
	column: number;
	edges: RowEdges;
	/** The highest column index that has any edge in this row. Used to bound the SVG width. */
	edgeColumnMax: number;
}

/**
 * A contiguous run of commits placed on a single lane (column) — bounded by where the
 * column was claimed (merge-back point on trunk, or null for unmerged heads) and where
 * the column was freed (fork point on trunk, or null when the fork is below the loaded
 * rows). Identity is the tip-commit sha (the topmost commit actually placed on the lane).
 *
 * The renderer uses these to power lane-collapse: a collapsed segment renders as a chip
 * row anchored at `tipSha` with the other commits removed from the displayed list.
 *
 * Segments with fewer than two commits are not emitted — there's nothing to fold.
 */
export interface LaneSegment {
	/** Stable identifier — currently equal to `tipSha`. */
	id: Sha;
	/** Topmost (newest) commit actually placed on this lane. */
	tipSha: Sha;
	/**
	 * Trunk commit where this branch was forked off (the row whose processing freed the
	 * column). `null` when the fork is below the loaded rows (open at the bottom).
	 */
	forkSha: Sha | null;
	/**
	 * Trunk commit that merged this branch back (the row that claimed the column for an
	 * additional parent). `null` for unmerged heads whose tip is the topmost row of the
	 * lane (claimed via own-row reservation).
	 */
	mergeSha: Sha | null;
	/** Column index when the segment was opened. May change mid-life if reassigned. */
	column: number;
	/** Commits placed on this lane in row processing order (newest → oldest). */
	commitShas: readonly Sha[];
}

/**
 * commit-graph-specific: describes a bounded view of a repo's history. Not used by the engine
 * directly; the data layer resolves a `GraphScope` into a `GraphRow[]` that it feeds in.
 */
export interface GraphScope {
	/** Merge-base tip: commits beyond this are hidden (the tip itself may be shown as an anchor). */
	trunkSha: Sha;
	/** Branch-head shas that are in scope — the commits reachable from any of these, excluding trunk's ancestors. */
	heads: Sha[];
}

/**
 * Hint to the layout that these shas should each get their own reserved lane. Used to
 * render stacked branches with distinct lanes/colors.
 *
 * Reserved: not yet consumed by the GitLens renderer. Kept as forward-looking engine vocabulary.
 */
export interface StackHint {
	/** Ordered list of shas to pin to successive low-numbered columns (column 0, 1, 2, ...). */
	pinnedShas: readonly Sha[];
}

/**
 * Minimum commit shape the view layer + default adornments rely on. Consumers extend this
 * with their own commit type; any superset of these fields works. Stable API contract —
 * additions are non-breaking, renames are not.
 */
export interface GraphCommit {
	hash: Sha;
	shortHash: string;
	message: string;
	author: string;
	/** Empty string is acceptable when an author email isn't available. */
	authorEmail: string;
	/** Commit timestamp as Unix epoch milliseconds (0 when unknown). */
	date: number;
	parents: Sha[];
	/**
	 * Optional override for the engine's auto-derived `CommitKind`. When present, takes
	 * precedence over the parent-count heuristic in `commitToGraphRow`. Use this for WIP
	 * rows (`'workdir'`) and stash rows (`'stash'`) which can't be inferred from `parents`.
	 */
	kind?: CommitKind;
	/**
	 * Decoration strings in the `git log %D` shape:
	 *   `["HEAD -> main", "origin/main", "tag: v1.0"]`
	 * The default ref adornment also tolerates space-tokenized variants.
	 */
	refs: string[];
	/**
	 * Opaque, host-supplied serialized context payload for the row. The renderer decides
	 * how (and whether) to emit it — the engine treats it as an inert string.
	 */
	contextData?: string;
	/**
	 * Opaque, host-supplied serialized context payloads keyed by ref name, one per ref
	 * pill. The renderer decides how (and whether) to emit each one.
	 */
	refContexts?: Readonly<Record<string, string>>;
}
