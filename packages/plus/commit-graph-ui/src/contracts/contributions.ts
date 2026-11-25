import type { TemplateResult } from 'lit';
import type { CommitGraphSourceRow } from './rows.js';

export interface GraphContextMenuRef {
	readonly id?: string;
	readonly name: string;
	/** Unique per pill; a local branch and the remote it tracks share `name` but never `key`. */
	readonly key: string;
	readonly kind: string;
	readonly remote: string | null;
	readonly vscodeContext?: string;
	readonly current: boolean;
}

/** Cancelable: cancel it to open the host's own menu at `clientX`/`clientY` instead of the native one. */
export interface GraphContextMenuDetail {
	readonly sha: string;
	readonly type: CommitGraphSourceRow['kind'];
	readonly zone: 'ref' | 'row';
	readonly clientX: number;
	readonly clientY: number;
	/** Present only for the `ref` zone. */
	readonly ref?: GraphContextMenuRef;
}

/** The built-in row buttons a host can serve; one left out of `supportedRowActions` isn't drawn. */
export type GraphBuiltInRowAction =
	| 'stash-apply'
	| 'stash-drop'
	| 'undo-commit'
	| 'open-changes'
	| 'jump-to-working-changes'
	| 'push-to-commit';

/** Cancelable: cancel it to open the host's own menu at `anchor` instead of the native one. Also fires on a
 *  right-click in the header, with `anchor` a zero-size rect at the pointer. */
export interface GraphHeaderMenuDetail {
	readonly anchor: DOMRect;
}

/** Cancelable: cancel it when the host owns the clipboard write. The contexts are present only for rows the host
 *  supplied them for. */
export interface GraphCopyRequestDetail {
	readonly sha: string;
	readonly selectionShas?: readonly string[];
	readonly vscodeContext?: string;
	readonly vscodeSelectionContexts?: readonly string[];
}

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
