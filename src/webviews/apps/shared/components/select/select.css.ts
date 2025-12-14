import { css } from 'lit';

export const selectStyles = css`
	:host {
		display: inline-block;
		width: 100%;
	}

	gl-select sl-select {
		width: 100%;
	}

	/* Base combobox styling */
	sl-select::part(combobox) {
		background-color: var(--vscode-dropdown-background);
		border: 1px solid var(--vscode-dropdown-border);
		border-radius: 3px;
		color: var(--vscode-dropdown-foreground);
		font-family: var(--vscode-font-family);
		font-size: inherit;
		line-height: 1.35;
		padding: 1px 4px;
	}

	sl-select::part(display-input) {
		field-sizing: content;
	}

	sl-select::part(expand-icon) {
		margin-inline-start: var(--sl-spacing-x-small);
	}

	/* Focus state */
	sl-select:focus-within::part(combobox) {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	/* Disabled state */
	sl-select[disabled]::part(combobox) {
		background-color: var(--vscode-input-background);
		color: var(--vscode-disabledForeground);
		cursor: not-allowed;
		opacity: 0.6;
	}

	/* Listbox (dropdown menu) */
	sl-select::part(listbox) {
		background-color: var(--vscode-dropdown-background);
		border: 1px solid var(--vscode-dropdown-border);
		border-radius: 3px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		padding: 4px 0;
	}

	/* Options */
	sl-option {
		font-family: var(--vscode-font-family);
		font-size: inherit;
	}

	sl-option::part(base) {
		background-color: transparent;
		color: var(--vscode-dropdown-foreground);
		padding: 4px 8px;
	}

	sl-option::part(base):hover {
		background-color: var(--vscode-list-hoverBackground);
		color: var(--vscode-list-hoverForeground);
	}

	sl-option[aria-selected='true']::part(base) {
		background-color: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}

	sl-option[disabled]::part(base) {
		color: var(--vscode-disabledForeground);
		cursor: not-allowed;
		opacity: 0.6;
	}
`;
