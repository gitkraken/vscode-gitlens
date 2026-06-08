import { css } from 'lit';

export const checkboxBaseStyles = css`
	:host {
		--checkbox-foreground: var(--vscode-checkbox-foreground);
		--checkbox-background: var(--vscode-checkbox-background);
		--checkbox-border: var(--vscode-checkbox-border);
		--checkbox-checked-foreground: var(--vscode-checkbox-foreground);
		--checkbox-checked-background: var(--vscode-checkbox-selectBackground);
		--checkbox-checked-border: var(--vscode-checkbox-selectBorder);
		--checkbox-active-background: var(--vscode-checkbox-selectBackground);
		--checkbox-active-border: var(--vscode-checkbox-selectBorder);
		--checkbox-hover-background: var(--vscode-inputOption-hoverBackground);
		--checkbox-radius: 3px;
		--checkbox-border-width: 1px;
		--checkbox-size: 1.6rem;
		--checkbox-spacing: 1rem;

		display: block;
		margin-block: 0.8rem;
	}

	label {
		display: flex;
		gap: var(--checkbox-spacing);
		align-items: center;
		color: var(--checkbox-foreground);
		white-space: nowrap;
		cursor: pointer;
		user-select: none;
	}

	:host([disabled]) label {
		cursor: default;
		opacity: 0.5;
	}

	.label-text {
		display: block;
		margin-inline-end: var(--checkbox-spacing);
		line-height: normal;
	}

	.input {
		position: absolute;
		z-index: -1;
		opacity: 0;
	}

	.control {
		position: relative;
		left: 1px;
		box-sizing: border-box;
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: var(--checkbox-size);
		height: var(--checkbox-size);
		color: var(--checkbox-foreground);
		background: var(--checkbox-background);
		border: var(--checkbox-border-width, 1px) solid var(--vscode-checkbox-border);
		border-radius: var(--checkbox-radius);
	}

	.input:hover + .control {
		background-color: var(--checkbox-hover-background);
	}

	.input:focus-visible + .control,
	.input:focus + .control {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: 2px;
	}

	.input:active + .control {
		background-color: var(--checkbox-active-background);
		border-color: var(--checkbox-active-border);
	}

	:host([checked]) .control,
	:host([indeterminate]) .control {
		color: var(--checkbox-checked-foreground);
		background-color: var(--checkbox-checked-background);
		border-color: var(--checkbox-checked-border);
	}

	code-icon {
		visibility: hidden;
		pointer-events: none;
	}

	:host([checked]) code-icon,
	:host([indeterminate]) code-icon {
		visibility: visible;
	}
`;
