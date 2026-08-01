import type { GitPausedOperationStatus, GitRebaseStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitRevisionReference } from '@gitlens/git/models/reference.js';
import { splitCommitMessage } from '@gitlens/git/utils/commit.utils.js';
import type { PausedOperationVariant } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { pausedOperationStatusStringsByType } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { pluralize, truncate } from '@gitlens/utils/string.js';

/** Longest commit subject a tooltip carries before it's elided. */
const maxSubjectLength = 50;

/** True when the strip shows the "at <m/t>" step context — also gates which strips drop their refs at narrow widths. */
export function isPausedOperationStepped(
	status: GitPausedOperationStatus,
	variant: PausedOperationVariant,
): status is GitRebaseStatus {
	return status.type === 'rebase' && variant !== 'pending';
}

/** The strip's leading phrase; the paused-at pill and the refs are appended to it by the caller. */
export function getPausedOperationBarLabel(status: GitPausedOperationStatus, variant: PausedOperationVariant): string {
	const strings = pausedOperationStatusStringsByType[status.type];
	if (variant === 'conflicts') return `${strings.prose} paused`;
	if (variant === 'pending' && status.type === 'rebase') {
		return pausedOperationStatusStringsByType.rebase.pending;
	}
	return strings.label;
}

/** The primary action's label — the conflict count rides on the button, where it's acted on. */
export function getPausedOperationBarActionLabel(
	status: GitPausedOperationStatus,
	variant: PausedOperationVariant,
	conflictsCount: number | undefined,
): string {
	if (variant === 'conflicts') {
		// Hosts that don't carry a count still get an actionable label.
		return conflictsCount == null ? 'Resolve Conflicts' : `Resolve ${pluralize('Conflict', conflictsCount)}`;
	}
	return `Continue ${pausedOperationStatusStringsByType[status.type].name}`;
}

/** Plain-words restatement of the state for label-only scanners, carried on the leading icon. */
export function getPausedOperationBarIconTooltip(
	status: GitPausedOperationStatus,
	variant: PausedOperationVariant,
	conflictsCount: number | undefined,
): string | undefined {
	switch (variant) {
		case 'conflicts': {
			const name = pausedOperationStatusStringsByType[status.type].prose.toLowerCase();
			return conflictsCount == null
				? `Conflicting files must be resolved before the ${name} can continue`
				: `${pluralize('conflicting file', conflictsCount)} must be resolved before the ${name} can continue`;
		}
		case 'pending':
			return undefined;
		case 'ready':
			return 'No unresolved conflicts — ready to continue';
	}
}

export function getPausedOperationAbortLabel(status: GitPausedOperationStatus): string {
	return `Abort ${pausedOperationStatusStringsByType[status.type].name}`;
}

/** The commit a skip drops: the rebase's current step, or the single commit a cherry-pick/revert applies. */
export function getPausedOperationSkipRef(status: GitPausedOperationStatus): GitRevisionReference | undefined {
	if (status.type === 'merge') return undefined;
	return status.type === 'rebase' ? status.steps.current.commit : status.incoming;
}

/** The Skip action's title; the victim rides in the tooltip detail, not the label. */
export function getPausedOperationSkipLabel(status: GitPausedOperationStatus): string {
	if (getPausedOperationSkipRef(status) == null) return 'Skip';
	return status.type === 'rebase' ? 'Skip Paused Commit' : 'Skip Commit';
}

/** The Skip tooltip's detail line — names the commit a skip would drop. */
export function getPausedOperationSkipDetail(status: GitPausedOperationStatus): string | undefined {
	return describePausedOperationCommit(getPausedOperationSkipRef(status));
}

/** The paused-at pill's tooltip: where the operation stands, plus the paused-on commit's subject. */
export function getPausedOperationStepTooltipParts(status: GitRebaseStatus): {
	detail: string;
	subject: string | undefined;
} {
	const step = `step ${status.steps.current.number} of ${status.steps.total}`;
	const sha = shortenRevision(status.steps.current.commit?.ref);

	const { summary } = splitCommitMessage(status.steps.current.commit?.message);
	return {
		detail: sha ? `Rebase paused at ${sha} (${step})` : `Rebase paused (${step})`,
		subject: summary ? `"${truncate(summary, maxSubjectLength)}"` : undefined,
	};
}

/** `<shortSha> "<subject>"` when the message is known, the sha alone otherwise. */
export function describePausedOperationCommit(ref: GitRevisionReference | undefined): string | undefined {
	if (!ref?.ref) return undefined;

	const sha = shortenRevision(ref.ref);
	if (!sha) return undefined;

	const { summary } = splitCommitMessage(ref.message);
	return summary ? `${sha} "${truncate(summary, maxSubjectLength)}"` : sha;
}
