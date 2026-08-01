import type { TemplateResult } from 'lit';
import { css, html, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '../../../shared/components/code-icon.js';

export type NextStepAction = {
	actionLabel: string;
	tooltip?: string;
	icon?: string;
	/** In-flight state — renders a disabled spinner button in place of the normal action, so the row
	 *  anchors its layout while a real action isn't yet available. Ignores `href`/`onClick`. */
	loading?: boolean;
} & ({ href: string; onClick?: never } | { onClick?: () => void; href?: never });

export type NextStep = {
	icon: string;
	iconFlip?: 'inline' | 'block';
	label: string;
	actionPrefixIcon?: string;
	/** Optional alt action — rendered as the small side of a split-button. */
	alt?: NextStepAction;
} & NextStepAction;

/** A suggested-action row: icon, label, and a primary button that may carry an alt split-button.
 *  Shared by the WIP empty pane and the branch sheet — pair with {@link nextStepStyles}. */
export function renderNextStep(step: NextStep): TemplateResult {
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
		<code-icon class="next-step__icon" icon=${step.icon} flip=${ifDefined(step.iconFlip)}></code-icon>
		<span class="next-step__label">${step.label}</span>
		${action}
	</div>`;
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
		color: var(--color-foreground--65);
	}

	.next-step__label {
		flex: 1;
		min-width: 0;
	}

	.next-step__action {
		flex-shrink: 0;
	}
`;
