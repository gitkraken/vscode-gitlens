import * as l10n from '@vscode/l10n';
import type { TemplateResult } from 'lit';
import { css, html, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { formatPullRequestMergeQueueStatus } from '@gitlens/git/utils/pullRequest.utils.js';
import type { MergeQueueEntryLike } from '../../shared/mergeQueue.utils.js';
import { isMergeQueueEntryFailing } from '../../shared/mergeQueue.utils.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '@gitlens/components/components/codeIcon.js';

export type NextStepAction = {
	actionLabel: string;
	tooltip?: string;
	icon?: string;
	/** In-flight state — renders a disabled spinner button in place of the normal action, so the row
	 *  anchors its layout while a real action isn't yet available. Ignores `href`/`onClick`. */
	loading?: boolean;
} & ({ href: string; onClick?: never } | { onClick?: () => void; href?: never });

/** A row with nothing to do — a status or a note. Renders no button at all rather than a dead one. */
type NextStepInfo = {
	actionLabel?: never;
	tooltip?: never;
	loading?: never;
	href?: never;
	onClick?: never;
	actionPrefixIcon?: never;
	alt?: never;
};

export type NextStep = {
	icon: string;
	iconFlip?: 'inline' | 'block';
	label: string;
	/** Tints the icon as a warning. Pair it with a warning glyph and wording, so colour never carries it alone. */
	severity?: 'warning';
	actionPrefixIcon?: string;
	/** Optional alt action — rendered as the small side of a split-button. */
	alt?: NextStepAction;
} & (NextStepAction | NextStepInfo);

/** A suggested-action row: icon, label, and a primary button that may carry an alt split-button — or, for a
 *  status/note row, no button. Shared by the WIP empty pane and the branch sheet — pair with {@link nextStepStyles}. */
export function renderNextStep(step: NextStep): TemplateResult {
	const iconClass = `next-step__icon${step.severity === 'warning' ? ' next-step__icon--warning' : ''}`;
	if (step.actionLabel == null) {
		return html`<div class="next-step">
			<code-icon class=${iconClass} icon=${step.icon} flip=${ifDefined(step.iconFlip)}></code-icon>
			<span class="next-step__label">${step.label}</span>
		</div>`;
	}

	const primaryInner = html`${
		step.actionPrefixIcon ? html`<code-icon icon=${step.actionPrefixIcon} slot="prefix"></code-icon>` : nothing
	}${step.actionLabel}`;
	const primary = step.loading
		? html`<gl-button
				class="next-step__action"
				appearance="secondary"
				disabled
				aria-label=${step.actionLabel}
				tooltip=${ifDefined(step.tooltip)}
				><code-icon icon="loading" modifier="spin"></code-icon
			></gl-button>`
		: step.href != null
			? html`<gl-button class="next-step__action" appearance="secondary" href=${step.href}
					>${primaryInner}</gl-button
				>`
			: html`<gl-button class="next-step__action" appearance="secondary" @click=${() => step.onClick?.()}
					>${primaryInner}</gl-button
				>`;

	const alt = step.alt;
	const altInner = alt?.icon ? html`<code-icon icon=${alt.icon}></code-icon>` : alt?.actionLabel;
	const altButton =
		alt == null
			? nothing
			: alt.href != null
				? html`<gl-button appearance="secondary" tooltip=${alt.tooltip ?? alt.actionLabel} href=${alt.href}
						>${altInner}</gl-button
					>`
				: html`<gl-button
						appearance="secondary"
						tooltip=${alt.tooltip ?? alt.actionLabel}
						@click=${() => alt.onClick?.()}
						>${altInner}</gl-button
					>`;

	const action =
		alt != null
			? html`<button-container class="next-step__action">${primary}${altButton}</button-container>`
			: primary;

	return html`<div class="next-step">
		<code-icon class=${iconClass} icon=${step.icon} flip=${ifDefined(step.iconFlip)}></code-icon>
		<span class="next-step__label">${step.label}</span>
		${action}
	</div>`;
}

/** The PR row while the pull request is queued: its queue status, opening the queue when the provider gave its URL
 *  (else the pull request itself). A queue that's failing it reads as a warning — glyph, tint and wording. */
export function createMergeQueueNextStep(pullRequestUrl: string, entry: MergeQueueEntryLike): NextStep {
	const failing = isMergeQueueEntryFailing(entry);
	const icon = failing ? 'warning' : 'git-pull-request';
	const label = formatPullRequestMergeQueueStatus(entry);
	const severity = failing ? 'warning' : undefined;

	if (entry.url == null) {
		return { icon: icon, label: label, severity: severity, actionLabel: l10n.t('View'), href: pullRequestUrl };
	}

	return {
		icon: icon,
		label: label,
		severity: severity,
		actionLabel: l10n.t('View Merge Queue'),
		href: entry.url,
		alt: {
			actionLabel: l10n.t('View Pull Request'),
			icon: 'git-pull-request',
			tooltip: l10n.t('View Pull Request'),
			href: pullRequestUrl,
		},
	};
}

export const nextStepStyles = css`
	.next-step {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-4) var(--gl-space-6);
		border-radius: var(--gl-radius-sm);
	}

	.next-step:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.next-step__icon {
		flex-shrink: 0;
		color: var(--vscode-descriptionForeground);
	}

	.next-step__icon--warning {
		color: var(--vscode-editorWarning-foreground);
	}

	.next-step__label {
		flex: 1;
		min-width: 0;
	}

	.next-step__action {
		flex-shrink: 0;
	}
`;
