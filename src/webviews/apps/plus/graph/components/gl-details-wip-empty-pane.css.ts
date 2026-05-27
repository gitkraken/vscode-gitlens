import { css } from 'lit';

export const detailsWipEmptyPaneStyles = css`
	:host {
		display: block;
		padding: 1rem 1.2rem 1.6rem;
	}

	.hub {
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.section__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.section__heading {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--color-foreground--65);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.section__heading-action {
		flex: none;
		--button-padding: 0.2rem;
		--button-line-height: 1.2rem;
	}

	.next-step {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.4rem 0.6rem;
		border-radius: var(--gk-action-radius, 0.3rem);
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

	.ai-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 0.6rem;
	}

	.ai-button {
		justify-content: flex-start;
		text-align: left;
	}

	.ai-button code-icon {
		margin-right: 0.4rem;
	}

	.start-new {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 20rem;
		max-width: 28rem;
		width: 100%;
		/* Match the visual heading-to-content gap of the Next-steps section. Next-step rows have
		   internal padding that effectively widens the gap from the section heading; bare buttons
		   don't, so add equivalent top padding here to keep section rhythm consistent. */
		padding-top: 0.8rem;
		padding-inline-start: 0.6rem;
	}

	.start-new gl-button {
		width: 100%;
		--button-width: 100%;
	}

	.start-new gl-button code-icon {
		margin-right: 0.4rem;
	}

	.launchpad-items {
		list-style: none;
		/* Match the left inset of Next-step rows so the launchpad items line up with the
		   Next-steps content column rather than sitting flush with the section heading. */
		padding-inline-start: 0.6rem;
		/* Matches the start-new top padding so the Launchpad heading-to-content gap reads the
		   same as the other sections — first launchpad row sits flush with where the first row
		   of Next-steps and the first button of Start-new sit. */
		margin-block: 0.8rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.launchpad-items--loading {
		gap: 0.4rem;
	}

	.launchpad-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1.2rem;
		color: inherit;
		text-decoration: none;
	}

	.launchpad-item__icon {
		color: var(--gl-launchpad-item-color, inherit);
	}

	.launchpad-item--link {
		cursor: pointer;
	}

	.launchpad-item--link:hover {
		text-decoration: none;
	}

	.launchpad-item--link:hover span {
		text-decoration: underline;
	}

	.launchpad-item--link:hover .launchpad-item__icon {
		color: var(--gl-launchpad-item-hover-color, var(--gl-launchpad-item-color, inherit));
	}

	.launchpad-item--link:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: 2px;
		border-radius: 0.2rem;
	}

	.launchpad-item--muted {
		color: var(--color-foreground--65);
		font-style: italic;
	}

	.launchpad-item--mergeable {
		--gl-launchpad-item-color: var(--vscode-gitlens-launchpadIndicatorMergeableColor);
		--gl-launchpad-item-hover-color: var(--vscode-gitlens-launchpadIndicatorMergeableHoverColor);
	}

	.launchpad-item--blocked {
		--gl-launchpad-item-color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
		--gl-launchpad-item-hover-color: var(--vscode-gitlens-launchpadIndicatorBlockedHoverColor);
	}

	.launchpad-item--attention {
		--gl-launchpad-item-color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
		--gl-launchpad-item-hover-color: var(--vscode-gitlens-launchpadIndicatorAttentionHoverColor);
	}
`;
