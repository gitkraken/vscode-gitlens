/**
 * Shared treemap data types used by:
 * - the host-side `TreemapAggregatorService` (file tree + commit-frequency builder)
 * - the `graphTreemap` RPC service contract on `GraphServices`
 * - the embedded webview components (`gl-graph-treemap`, `gl-treemap-chart`)
 *
 * No webview is registered for treemap — these types describe the data flowing through the Graph
 * webview's existing IPC for the embedded Visual History → Treemap visualization.
 */

export type TreemapMode = 'files' | 'commits' | 'activity';

/** Scope/window config the webview hands the host when fetching treemap data. Mirrors the
 *  shape used by `TimelineConfig` so the embedded Treemap honors the same Graph-level filters
 *  (branches visibility, scope picker, period selector) the embedded Timeline does. */
export interface TreemapConfig {
	/** True when the Graph is in "All Branches" visibility AND no specific branch is scoped — the
	 *  aggregator uses git's `--all` shortcut. False means walk only `head` + `additionalBranches`. */
	showAllBranches: boolean;
	/** Extra branch refs to walk (in addition to `head`) when `showAllBranches` is false. Maps to
	 *  the Graph's `includeOnlyRefs` filter for smart/favorited/current visibility modes. */
	additionalBranches?: string[];
	/** Branch ref to use as walk head; when undefined, the aggregator uses HEAD. */
	head?: string;
	/** Window cutoff (`since: now - loadedSpanMs`) used when set; otherwise defaults to 1y. The
	 *  embedded view sets this to match the Graph's loaded span so the treemap reflects exactly the
	 *  history the user is seeing. */
	loadedSpanMs?: number;
}

export interface TreemapNode {
	name: string;
	path: string;
	size: number;
	type: 'folder' | 'file';
	children?: TreemapNode[];
}

export interface CommitFrequencyData {
	/** Per-file commit count, keyed by forward-slash repo-relative path. */
	frequencies: Record<string, number>;
	/** Unique-commit count per folder, keyed by forward-slash repo-relative folder path (no
	 *  trailing slash; the empty string `''` represents the repo root). Counts each commit ONCE
	 *  per folder even when it touches multiple files in that folder, so summing children's
	 *  per-file counts (the wrong-but-cheap alternative) inflates the number. Computed by the
	 *  host during the same commit walk that produces `frequencies`. */
	folderFrequencies: Record<string, number>;
	maxFrequency: number;
	/** Total unique commit count across the walked window (== `folderFrequencies['']`). Cached
	 *  here so the webview can render "X commits" for the unscoped root without a re-lookup. */
	totalCommits: number;
}

export interface TreemapData {
	root: TreemapNode | undefined;
	frequencies: CommitFrequencyData | undefined;
}
