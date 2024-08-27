import { css } from 'lit';

export const checkboxStyles = css`
	:host {
		--design-unit: 4;
		--checkbox-corner-radius: 3;
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

	input[type='checkbox'] {
		position: absolute;
		z-index: -1;
		opacity: 0;
	}
	input[type='checkbox'] + .control {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		position: relative;
		width: calc(var(--design-unit) * 4px + 2px);
		height: calc(var(--design-unit) * 4px + 2px);
		box-sizing: border-box;
		border-radius: calc(var(--checkbox-corner-radius) * 1px);
		border: calc(var(--border-width) * 1px) solid var(--vscode-checkbox-border);
		background: var(--vscode-checkbox-background);
	}

	label:not([aria-disabled]) input[type='checkbox']:hover + .control {
		background: var(--vscode-checkbox-background);
		border-color: var(--vscode-checkbox-border);
	}

	label:not([aria-disabled]) input[type='checkbox']:focus-visible + .control,
	label:not([aria-disabled]) input[type='checkbox']:focus + .control {
		outline: 1px solid var(--vscode-focusBorder);
	}

	label:not([aria-disabled]):active input[type='checkbox'] + .control,
	label:not([aria-disabled]) input[type='checkbox']:active + .control {
		background: var(--vscode-checkbox-background);
		border-color: var(--vscode-focusBorder);
	}

	code-icon {
		pointer-events: none;
	}
`;
