import { css } from 'lit';

export const radioStyles = css`
	:host {
		--design-unit: 4;
		--border-width: 1;
	}
	label {
		display: flex;
		gap: calc(var(--design-unit) * 2px + 2px);
		align-items: center;
		color: var(--vscode-checkbox-foreground);
		margin-inline-end: calc(var(--design-unit) * 2px + 2px);
		user-select: none;
		white-space: nowrap;
	}

	label {
		cursor: pointer;
	}
	label[aria-disabled] {
		cursor: default;
		opacity: 0.5;
	}

	button {
		position: absolute;
		z-index: -1;
		opacity: 0;
	}
	button + .control {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		position: relative;
		width: calc(var(--design-unit) * 4px + 2px);
		height: calc(var(--design-unit) * 4px + 2px);
		box-sizing: border-box;
		border-radius: 50%;
		border: calc(var(--border-width) * 1px) solid var(--vscode-checkbox-border);
		background: var(--vscode-checkbox-background);
	}

	label:not([aria-disabled]) button:hover + .control {
		background: var(--vscode-checkbox-background);
		border-color: var(--vscode-checkbox-border);
	}

	label:not([aria-disabled]) button:focus-visible + .control,
	label:not([aria-disabled]) button:focus + .control {
		outline: 1px solid var(--vscode-focusBorder);
	}

	label:not([aria-disabled]):active button + .control,
	label:not([aria-disabled]) button:active + .control {
		background: var(--vscode-checkbox-background);
		border-color: var(--vscode-focusBorder);
	}

	code-icon {
		pointer-events: none;
	}
`;
