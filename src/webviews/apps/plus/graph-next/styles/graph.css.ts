import { css } from 'lit';
import { focusOutline } from '../../../shared/components/styles/lit/a11y.css';

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

export const ruleBase = css`
	hr {
		border: none;
		border-top: 1px solid var(--color-foreground--25);
	}
`;

export const actionButton = css`
	.action-button {
		position: relative;
		appearance: none;
		font-family: inherit;
		font-size: 1.2rem;
		line-height: 2.2rem;
		// background-color: var(--color-graph-actionbar-background);
		background-color: transparent;
		border: none;
		color: inherit;
		color: var(--color-foreground);
		padding: 0 0.75rem;
		cursor: pointer;
		border-radius: 3px;
		height: auto;

		display: grid;
		grid-auto-flow: column;
		grid-gap: 0.5rem;
		gap: 0.5rem;
		max-width: fit-content;
	}

	.action-button[disabled] {
		pointer-events: none;
		cursor: default;
		opacity: 1;
	}

	.action-button:hover {
		background-color: var(--color-graph-actionbar-selectedBackground);
		color: var(--color-foreground);
		text-decoration: none;
	}

	.action-button[aria-checked] {
		border: 1px solid transparent;
	}

	.action-button[aria-checked='true'] {
		background-color: var(--vscode-inputOption-activeBackground);
		color: var(--vscode-inputOption-activeForeground);
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
		font-size: 1rem;
		margin-right: -0.25rem;
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
		font-size: smaller;
		opacity: 0.6;
		text-overflow: ellipsis;
		overflow: hidden;
	}

	.action-button__truncated {
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
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
