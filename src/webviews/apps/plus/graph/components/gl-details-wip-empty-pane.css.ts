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

	.hub--idle {
		align-items: center;
		text-align: center;
		padding-top: 2rem;
		gap: 1.2rem;
	}

	.caption {
		margin: 0;
		color: var(--color-foreground--65);
		font-style: italic;
	}

	.section {
		display: flex;
		flex-direction: column;
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

	.start-fresh {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 20rem;
		max-width: 28rem;
		width: 100%;
	}

	.start-fresh gl-button {
		width: 100%;
		--button-width: 100%;
	}

	.start-fresh gl-button code-icon {
		margin-right: 0.4rem;
	}
`;
