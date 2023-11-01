import { css } from 'lit';

export const rowBaseStyles = css`
	:host {
		display: block;
	}

	p {
		margin: 0;
	}

	a {
		color: var(--vscode-textLink-foreground);
		text-decoration: none;
	}
	a:hover {
		text-decoration: underline;
	}
	a:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	.actions gk-tooltip {
		display: inline-block;
	}

	.actions a {
		box-sizing: border-box;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 3.2rem;
		height: 3.2rem;
		border-radius: 0.5rem;
		color: inherit;
		padding: 0.2rem;
		vertical-align: text-bottom;
		text-decoration: none;
		cursor: pointer;
	}
	.actions a:hover {
		background-color: var(--vscode-toolbar-hoverBackground);
	}
	.actions a:active {
		background-color: var(--vscode-toolbar-activeBackground);
	}
	.actions a[tabindex='-1'] {
		opacity: 0.5;
		cursor: default;
	}

	.actions a code-icon {
		font-size: 1.6rem;
	}

	.indicator-info {
		color: var(--vscode-problemsInfoIcon-foreground);
	}
	.indicator-warning {
		color: var(--vscode-problemsWarningIcon-foreground);
	}
	.indicator-error {
		color: var(--vscode-problemsErrorIcon-foreground);
	}
	.indicator-neutral {
		color: var(--color-alert-neutralBorder);
	}

	.row-type {
		--gk-badge-outline-padding: 0.3rem 0.8rem;
		--gk-badge-font-size: 1.1rem;
		opacity: 0.4;
		vertical-align: middle;
	}

	.title {
		font-size: 1.4rem;
	}

	.add-delete {
		margin-left: 0.4rem;
		margin-right: 0.2rem;
	}

	.key {
		z-index: 1;
		position: relative;
	}

	.date {
		display: inline-block;
		min-width: 1.6rem;
		line-height: 2.4rem;
	}

	.icon {
		box-sizing: border-box;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 2.4rem;
		height: 2.4rem;
	}

	.pin {
		color: inherit;
		text-decoration: none;
		cursor: pointer;
		opacity: 0.4;
	}
	.pin:hover {
		opacity: 0.64;
		text-decoration: none;
	}

	gk-focus-row:not(:hover):not(:focus-within) .pin:not(.is-active) {
		opacity: 0;
	}

	.pin.is-active {
		opacity: 1;
	}
`;
