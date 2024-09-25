import { css } from 'lit';

export const checkboxBaseStyles = css`
	:host {
		display: block;
		margin-block: 0.8rem;
	}

	label {
		display: flex;
		gap: var(--label-spacing);
		align-items: center;
		color: var(--vscode-checkbox-foreground);
		user-select: none;
		white-space: nowrap;
		cursor: pointer;
	}

	label[aria-disabled] {
		cursor: default;
		opacity: 0.5;
	}

	.label-text {
		display: block;
		line-height: normal;
		margin-inline-end: var(--label-spacing);
	}

	.input {
		position: absolute;
		z-index: -1;
		opacity: 0;
	}
	.control {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		position: relative;
		width: var(--control-size);
		height: var(--control-size);
		box-sizing: border-box;
		border-radius: var(--control-corner-radius);
		border: var(--control-border-width) solid var(--vscode-checkbox-border);
		background: var(--vscode-checkbox-background);
	}

	label:not([aria-disabled]) .input:hover + .control {
		background: var(--vscode-checkbox-background);
		border-color: var(--vscode-checkbox-border);
	}

	label:not([aria-disabled]) .input:focus-visible + .control,
	label:not([aria-disabled]) .input:focus + .control {
		outline: 1px solid var(--vscode-focusBorder);
	}

	label:not([aria-disabled]):active .input + .control,
	label:not([aria-disabled]) .input:active + .control {
		background: var(--vscode-checkbox-background);
		border-color: var(--vscode-focusBorder);
	}

	code-icon {
		pointer-events: none;
	}
`;
