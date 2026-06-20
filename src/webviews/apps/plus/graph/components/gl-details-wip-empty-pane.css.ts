import { css } from 'lit';

export const detailsWipEmptyPaneStyles = css`
	:host {
		display: block;
		padding: var(--gl-space-10) var(--gl-space-12) var(--gl-space-16);
	}

	.hub {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-16);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-6);
	}

	.section__header {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		justify-content: space-between;
	}

	.section__heading {
		margin: 0;
		font-size: var(--gl-font-sm);
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

	.ai-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--gl-space-6);
	}

	.ai-button {
		justify-content: flex-start;
		text-align: left;
	}

	.ai-button code-icon {
		margin-right: var(--gl-space-4);
	}

	.start-new {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-6);
		width: 100%;
		min-width: 20rem;
		max-width: 28rem;
		padding-inline-start: var(--gl-space-6);

		/* Match the visual heading-to-content gap of the Next-steps section. Next-step rows have
		   internal padding that effectively widens the gap from the section heading; bare buttons
		   don't, so add equivalent top padding here to keep section rhythm consistent. */
		padding-top: var(--gl-space-8);
	}

	.start-new gl-button {
		width: 100%;
		--button-width: 100%;
	}

	.start-new gl-button code-icon {
		margin-right: var(--gl-space-4);
	}

	.launchpad-items {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);

		/* Match the left inset of Next-step rows so the launchpad items line up with the
		   Next-steps content column rather than sitting flush with the section heading. */
		padding-inline-start: var(--gl-space-6);

		/* Matches the start-new top padding so the Launchpad heading-to-content gap reads the
		   same as the other sections — first launchpad row sits flush with where the first row
		   of Next-steps and the first button of Start-new sit. */
		margin-block: var(--gl-space-8) var(--gl-space-6);
		list-style: none;
	}

	.launchpad-items--loading {
		gap: var(--gl-space-4);
	}

	.launchpad-item {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		font-size: var(--gl-font-md);
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
		border-radius: var(--gl-radius-xs);
	}

	.launchpad-item--muted {
		font-style: italic;
		color: var(--color-foreground--65);
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
