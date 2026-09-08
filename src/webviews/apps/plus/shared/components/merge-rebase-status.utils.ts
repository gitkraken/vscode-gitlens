import * as l10n from '@vscode/l10n';
import type { GitPausedOperationStatus, GitRebaseStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitReference, GitRevisionReference } from '@gitlens/git/models/reference.js';
import { getConflictCurrentRef } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import type { PausedOperationVariant } from '@gitlens/utils/pausedOperation.js';
import { splitMessage, truncate } from '@gitlens/utils/string.js';

/** Longest commit subject a tooltip carries before it's elided. */
const maxSubjectLength = 50;

/** True when the strip shows the "at <m/t>" step context. */
export function isPausedOperationStepped(
	status: GitPausedOperationStatus,
	variant: PausedOperationVariant,
): status is GitRebaseStatus {
	return status.type === 'rebase' && variant !== 'pending';
}

/** The primary action's label — the conflict count rides on the button, where it's acted on. */
export function getPausedOperationBarActionLabel(
	status: GitPausedOperationStatus,
	variant: PausedOperationVariant,
	conflictsCount: number | undefined,
): string {
	if (variant === 'conflicts') {
		// Hosts that don't carry a count still get an actionable label.
		if (conflictsCount == null) return l10n.t('Resolve Conflicts');

		return conflictsCount === 1
			? l10n.t('Resolve {count} Conflict', { count: getNumericFormat()(conflictsCount) })
			: l10n.t('Resolve {count} Conflicts', { count: getNumericFormat()(conflictsCount) });
	}

	switch (status.type) {
		case 'cherry-pick':
			return l10n.t('Continue Cherry Pick');
		case 'merge':
			return l10n.t('Continue Merge');
		case 'rebase':
			return l10n.t('Continue Rebase');
		case 'revert':
			return l10n.t('Continue Revert');
	}
}

/** `Merging feature into main` — names the operands the ref chips carry, so the identity survives the
 *  narrow-width shed. Undefined when either side can't be named. */
export function getPausedOperationBarRefsSummary(status: GitPausedOperationStatus): string | undefined {
	const current = nameRef(getConflictCurrentRef(status));
	const incoming = nameRef(status.incoming);
	if (current == null || incoming == null) return undefined;

	switch (status.type) {
		case 'cherry-pick':
			return l10n.t('Cherry picking {incoming} into {current}', { incoming: incoming, current: current });
		case 'merge':
			return l10n.t('Merging {incoming} into {current}', { incoming: incoming, current: current });
		case 'rebase':
			return l10n.t('Rebasing {incoming} onto {current}', { incoming: incoming, current: current });
		case 'revert':
			return l10n.t('Reverting {incoming} in {current}', { incoming: incoming, current: current });
	}
}

function nameRef(ref: GitReference | undefined): string | undefined {
	if (ref == null) return undefined;

	return ref.refType === 'branch' ? ref.name : shortenRevision(ref.ref) || undefined;
}

/** Plain-words restatement of the state for label-only scanners, carried on the leading icon. Leads with
 *  the operands, which are the only place they're named once the refs shed at narrow widths. */
export function getPausedOperationBarIconTooltip(
	status: GitPausedOperationStatus,
	variant: PausedOperationVariant,
	conflictsCount: number | undefined,
): string | undefined {
	const state = getPausedOperationBarStateTooltip(status, variant, conflictsCount);
	const refs = getPausedOperationBarRefsSummary(status);
	return refs == null
		? state
		: l10n.t({
				message: '{references}. {state}',
				args: { references: refs, state: state },
				comment: [
					'Paused Git operation tooltip. “references” names both refs and “state” is a complete status sentence.',
				],
			});
}

function getPausedOperationBarStateTooltip(
	status: GitPausedOperationStatus,
	variant: PausedOperationVariant,
	conflictsCount: number | undefined,
): string {
	if (variant === 'pending') {
		return l10n.t('The rebase hasn’t reached its first step');
	}

	if (variant !== 'conflicts') return l10n.t('No unresolved conflicts — ready to continue');

	switch (status.type) {
		case 'cherry-pick':
			if (conflictsCount == null) {
				return l10n.t('Conflicting files must be resolved before the cherry-pick can continue');
			}

			return conflictsCount === 1
				? l10n.t('{count} conflicting file must be resolved before the cherry-pick can continue', {
						count: getNumericFormat()(conflictsCount),
					})
				: l10n.t('{count} conflicting files must be resolved before the cherry-pick can continue', {
						count: getNumericFormat()(conflictsCount),
					});
		case 'merge':
			if (conflictsCount == null) {
				return l10n.t('Conflicting files must be resolved before the merge can continue');
			}

			return conflictsCount === 1
				? l10n.t('{count} conflicting file must be resolved before the merge can continue', {
						count: getNumericFormat()(conflictsCount),
					})
				: l10n.t('{count} conflicting files must be resolved before the merge can continue', {
						count: getNumericFormat()(conflictsCount),
					});
		case 'rebase':
			if (conflictsCount == null) {
				return l10n.t('Conflicting files must be resolved before the rebase can continue');
			}

			return conflictsCount === 1
				? l10n.t('{count} conflicting file must be resolved before the rebase can continue', {
						count: getNumericFormat()(conflictsCount),
					})
				: l10n.t('{count} conflicting files must be resolved before the rebase can continue', {
						count: getNumericFormat()(conflictsCount),
					});
		case 'revert':
			if (conflictsCount == null) {
				return l10n.t('Conflicting files must be resolved before the revert can continue');
			}

			return conflictsCount === 1
				? l10n.t('{count} conflicting file must be resolved before the revert can continue', {
						count: getNumericFormat()(conflictsCount),
					})
				: l10n.t('{count} conflicting files must be resolved before the revert can continue', {
						count: getNumericFormat()(conflictsCount),
					});
	}
}

export function getPausedOperationAbortLabel(status: GitPausedOperationStatus): string {
	switch (status.type) {
		case 'cherry-pick':
			return l10n.t('Abort Cherry Pick');
		case 'merge':
			return l10n.t('Abort Merge');
		case 'rebase':
			return l10n.t('Abort Rebase');
		case 'revert':
			return l10n.t('Abort Revert');
	}
}

/** The commit a skip drops: the rebase's current step, or the single commit a cherry-pick/revert applies. */
export function getPausedOperationSkipRef(status: GitPausedOperationStatus): GitRevisionReference | undefined {
	if (status.type === 'merge') return undefined;
	return status.type === 'rebase' ? status.steps.current.commit : status.incoming;
}

/** The Skip action's title; the victim rides in the tooltip detail, not the label. */
export function getPausedOperationSkipLabel(status: GitPausedOperationStatus): string {
	if (getPausedOperationSkipRef(status) == null) return l10n.t('Skip');
	return status.type === 'rebase' ? l10n.t('Skip Paused Commit') : l10n.t('Skip Commit');
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
	const sha = shortenRevision(status.steps.current.commit?.ref);
	const current = `${status.steps.current.number}`;
	const total = `${status.steps.total}`;

	const { summary } = splitMessage(status.steps.current.commit?.message);
	return {
		detail: sha
			? l10n.t('Rebase paused at {sha} (step {current} of {total})', {
					sha: sha,
					current: current,
					total: total,
				})
			: l10n.t('Rebase paused (step {current} of {total})', { current: current, total: total }),
		subject: summary ? l10n.t('"{subject}"', { subject: truncate(summary, maxSubjectLength) }) : undefined,
	};
}

/** `<shortSha> "<subject>"` when the message is known, the sha alone otherwise. */
export function describePausedOperationCommit(ref: GitRevisionReference | undefined): string | undefined {
	if (!ref?.ref) return undefined;

	const sha = shortenRevision(ref.ref);
	if (!sha) return undefined;

	const { summary } = splitMessage(ref.message);
	return summary ? l10n.t('{sha} "{subject}"', { sha: sha, subject: truncate(summary, maxSubjectLength) }) : sha;
}
