import { css } from 'lit';

export const commitActionStyles = css`
	.commit-action {
		display: inline-flex;
		gap: var(--gl-space-2);
		align-items: center;
		justify-content: center;
		height: 2rem;
		padding: var(--gl-space-2);
		vertical-align: middle;
		color: inherit;
		text-decoration: none;
		border-radius: 0.25em;
	}

	.commit-action > * {
		pointer-events: none;
	}

	.commit-action:focus {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	.commit-action:hover {
		color: var(--vscode-foreground);
		text-decoration: none;
	}

	:host-context(.vscode-dark) .commit-action:hover,
	:host-context(.vscode-high-contrast:not(.vscode-high-contrast-light)) .commit-action:hover {
		background-color: var(--color-background--lighten-15);
	}

	:host-context(.vscode-light) .commit-action:hover,
	:host-context(.vscode-high-contrast-light) .commit-action:hover {
		background-color: var(--color-background--darken-15);
	}

	:host-context(.vscode-dark) .commit-action.is-active,
	:host-context(.vscode-high-contrast:not(.vscode-high-contrast-light)) .commit-action.is-active {
		background-color: var(--color-background--lighten-10);
	}

	:host-context(.vscode-light) .commit-action.is-active,
	:host-context(.vscode-high-contrast-light) .commit-action.is-active {
		background-color: var(--color-background--darken-10);
	}

	.commit-action.is-disabled {
		pointer-events: none;
		opacity: 0.5;
	}

	.commit-action.is-hidden {
		display: none;
	}

	.commit-action--emphasis-low:not(:hover, :focus, :active) {
		opacity: 0.5;
	}

	.pr--opened {
		color: var(--vscode-gitlens-openPullRequestIconColor);
	}

	.pr--closed {
		color: var(--vscode-gitlens-closedPullRequestIconColor);
	}

	.pr--merged {
		color: var(--vscode-gitlens-mergedPullRequestIconColor);
	}
`;
