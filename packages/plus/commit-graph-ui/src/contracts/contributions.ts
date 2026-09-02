import type { TemplateResult } from 'lit';

/** A product-supplied button on a working-changes row's action strip. Hosts build these ONCE per WIP-state
 *  change (never per render); the kernel renders them verbatim and routes clicks via `data-wip-open`. */
export interface GraphRowAction {
	/** `data-wip-open` value the host's click delegation routes on. */
	readonly action: string;
	readonly icon: string;
	/** Tooltip, and the accessible name unless `ariaLabel` is set. */
	readonly label: string;
	/** Accessible name when the tooltip carries more than the name (e.g. an `[Alt]` alternate line). */
	readonly ariaLabel?: string;
	/** Always visible (`--persistent`) vs revealed on row hover/focus/selection (`--gated`). */
	readonly persistent: boolean;
	readonly className?: string;
	/** Corner status badge: a code-icon name rendered on the shared `.gl-graph__row-action-status` chip
	 *  (`'loading'` spins), or a host template rendered as-is. */
	readonly status?: string | TemplateResult;
}

/** Product hook for a working-changes row's native context-menu payload. `hasBranch` is false for a
 *  detached-HEAD worktree, whose row has no branch for branch-scoped menu items to act on; the surface
 *  can't derive it (per-worktree branch state belongs to the product), so it comes from the surface's
 *  `wipRowHasBranch` hook and defaults to true when the product supplies none. */
export type GraphWipRowContextResolver = (
	worktreePath: string,
	secondary: boolean,
	hasConflicts: boolean,
	hasBranch: boolean,
) => string | undefined;

/** Product hook answering whether a working-changes row's worktree has a branch — see
 *  {@link GraphWipRowContextResolver}. Per-row (not a static profile value) because it changes as the
 *  product's worktree state does. */
export type GraphWipRowBranchResolver = (rowId: string) => boolean;
