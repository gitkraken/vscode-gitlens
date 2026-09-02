import type { PausedOperationVariant } from '@gitlens/utils/pausedOperation.js';
import {
	getPausedOperationLabel,
	getPausedOperationVariant,
	pausedOperationStatusStringsByType,
} from '@gitlens/utils/pausedOperation.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { CommitGraphPausedOperationStatus } from '../contracts/state.js';

export interface PausedOperationIndicatorInfo {
	variant: PausedOperationVariant;
	label: string;
}

/**
 * Converts the renderer's deliberately small paused-operation contract into the visual state used by
 * work-directory rows. This is evaluated only for work-directory adornments; it is not on the normal
 * commit-row path.
 */
export function getPausedOperationIndicator(
	pausedOperation: CommitGraphPausedOperationStatus | undefined,
	hasConflicts: boolean,
	conflictsCount: number | undefined,
): PausedOperationIndicatorInfo | undefined {
	if (pausedOperation == null) {
		if (!hasConflicts) return undefined;

		return { variant: 'conflicts', label: `${pluralize('conflict', conflictsCount ?? 1)} to resolve` };
	}

	const variant = getPausedOperationVariant(pausedOperation, hasConflicts);
	// The type-specific "Resolve conflicts to continue rebasing" sentence reads better on a row than the
	// shared "Rebase Paused" phrase when there's something to act on; every other variant uses the shared
	// ladder so the row, the WIP badge, and the bar can't disagree.
	return {
		variant: variant,
		label:
			variant === 'conflicts'
				? pausedOperationStatusStringsByType[pausedOperation.type].conflicts
				: getPausedOperationLabel(pausedOperation, variant),
	};
}
