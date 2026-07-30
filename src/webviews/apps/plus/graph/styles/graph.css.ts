import { css } from 'lit';
import { focusOutline } from '../../../shared/components/styles/lit/a11y.css.js';

export const linkBase = css`
	a {
		text-decoration: none;
	}

	a:focus {
		${focusOutline}
	}

	a:hover {
		text-decoration: underline;
	}
`;

export const actionButton = css`
	.action-button {
		position: relative;
		box-sizing: border-box;
		display: grid;
		grid-auto-flow: column;
		gap: 0.5rem;
		align-items: center;
		max-width: fit-content;
		height: auto;

		/* Match the taller gl-button/ref-button controls in the header (~2.6rem). The bare line-height
		   only yields ~2.2rem, leaving these buttons visibly shorter than their neighbors. */
		min-height: 2.6rem;
		padding: 0 0.4rem;
		font-family: inherit;
		font-size: var(--gl-font-md);
		line-height: 2.2rem;
		color: var(--vscode-foreground);
		text-decoration: none;
		appearance: none;
		cursor: pointer;
		/* background-color: var(--color-graph-actionbar-background); */
		background-color: transparent;
		border: none;
		border-radius: var(--gl-radius-sm);
	}

	.action-button[disabled] {
		pointer-events: none;
		cursor: default;
		opacity: 1;
	}

	.action-button:hover {
		color: var(--vscode-foreground);
		text-decoration: none;
		background-color: var(--color-graph-actionbar-selectedBackground);
	}

	.action-button[aria-checked] {
		border: var(--gl-border-width) solid transparent;
	}

	.action-button[aria-checked='true'] {
		color: var(--vscode-inputOption-activeForeground);
		background-color: var(--vscode-inputOption-activeBackground);
		border-color: var(--vscode-inputOption-activeBorder);
	}

	.action-button code-icon {
		line-height: 2.2rem;
		vertical-align: bottom;
	}

	.action-button code-icon[icon='graph-line'] {
		transform: translateY(1px);
	}

	.is-ahead .action-button__pill {
		background-color: var(--branch-status-ahead-pill-background);
	}

	.is-behind .action-button__pill {
		background-color: var(--branch-status-behind-pill-background);
	}

	.is-ahead.is-behind .action-button__pill {
		background-color: var(--branch-status-both-pill-background);
	}

	.action-button__more,
	.action-button__more.codicon[class*='codicon-'] {
		margin-right: -0.25rem;
		font-size: var(--gl-font-micro);
	}

	code-icon.action-button__more::before {
		margin-left: -0.25rem;
	}

	.action-button__indicator {
		margin-left: -0.2rem;
		--gl-indicator-color: green;
		--gl-indicator-size: 0.4rem;
	}

	.action-button__small {
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: smaller;
		opacity: 0.6;
	}

	.action-button.is-ahead {
		background-color: var(--branch-status-ahead-background);
	}

	.action-button.is-ahead:hover {
		background-color: var(--branch-status-ahead-hover-background);
	}

	.action-button.is-behind {
		background-color: var(--branch-status-behind-background);
	}

	.action-button.is-behind:hover {
		background-color: var(--branch-status-behind-hover-background);
	}

	.action-button.is-ahead.is-behind {
		background-color: var(--branch-status-both-background);
	}

	.action-button.is-ahead.is-behind:hover {
		background-color: var(--branch-status-both-hover-background);
	}
`;
