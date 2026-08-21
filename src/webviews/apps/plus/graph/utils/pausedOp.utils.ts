import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { PausedOperationVariant } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import {
	getPausedOperationVariant,
	pausedOperationStatusStringsByType,
} from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import { getPausedOperationBarLabel } from '../../shared/components/merge-rebase-status.utils.js';

// Re-exported so both consumers (the WIP stats pill's adornment provider and `graph-row.ts`'s
// aria-label suffix) can pull the whole paused-op vocabulary from ONE place instead of reaching into
// the git package directly from two spots in the graph webview.
export type { PausedOperationVariant } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
export { pausedOperationVariantIcons } from '@gitlens/git/utils/pausedOperationStatus.utils.js';

export interface PausedOpIndicatorInfo {
	variant: PausedOperationVariant;
	label: string;
}

/**
 * Resolves a workdir row's (own OR peer worktree) paused-op/conflicts state into the variant + label
 * both the WIP stats pill (`wipStatsAdornmentProvider.ts`'s `renderWipStatsBadge`/`describeForA11y`) and
 * `graph-row.ts`'s row `aria-label` suffix read — the one place this decision is made, so the surfaces
 * can't drift, the same way `unpulledTooltip`/`unpulledAriaText` are kept in sync for the unpulled
 * indicator. Returns `undefined` when there's nothing to show.
 *
 * Conflicts with NO paused operation are possible (e.g. a plain `git merge` left conflicts with no
 * rebase/cherry-pick/revert in flight) — there's no {@link GitPausedOperationStatus} to read a type or
 * label from in that case, so the label falls back to a conflict-count sentence instead of
 * `getPausedOperationBarLabel`/`pausedOperationStatusStringsByType`.
 */
export function pausedOpIndicatorInfo(
	pausedOp: GitPausedOperationStatus | undefined,
	hasConflicts: boolean,
	conflictsCount: number | undefined,
): PausedOpIndicatorInfo | undefined {
	if (pausedOp == null) {
		if (!hasConflicts) return undefined;

		return { variant: 'conflicts', label: `${pluralize('conflict', conflictsCount ?? 1)} to resolve` };
	}

	const variant = getPausedOperationVariant(pausedOp, hasConflicts);
	// The type-specific "Resolve conflicts to continue rebasing" sentence reads better than the generic
	// "Rebase paused" bar label when there's something to act on.
	const label =
		variant === 'conflicts'
			? pausedOperationStatusStringsByType[pausedOp.type].conflicts
			: getPausedOperationBarLabel(pausedOp, variant);
	return { variant: variant, label: label };
}
