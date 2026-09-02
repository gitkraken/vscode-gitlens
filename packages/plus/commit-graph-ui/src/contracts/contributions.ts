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

/** Product hook for a working-changes row's native context-menu payload. */
export type GraphWipRowContextResolver = (
	worktreePath: string,
	secondary: boolean,
	hasConflicts: boolean,
) => string | undefined;
