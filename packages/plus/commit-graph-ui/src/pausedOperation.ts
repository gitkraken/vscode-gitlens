import type { PausedOperationVariant } from '@gitlens/utils/pausedOperation.js';
import { getPausedOperationVariant, pausedOperationStatusStringsByType } from '@gitlens/utils/pausedOperation.js';
import type { CommitGraphPausedOperationStatus } from './contracts/state.js';

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

		const count = conflictsCount ?? 1;
		return { variant: 'conflicts', label: `${count} ${count === 1 ? 'conflict' : 'conflicts'} to resolve` };
	}

	const variant = getPausedOperationVariant(pausedOperation, hasConflicts);
	const strings = pausedOperationStatusStringsByType[pausedOperation.type];
	return {
		variant: variant,
		label: variant === 'conflicts' ? strings.conflicts : variant === 'pending' ? 'Pending Rebase' : strings.label,
	};
}
