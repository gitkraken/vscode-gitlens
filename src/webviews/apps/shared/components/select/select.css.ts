import { css } from 'lit';

export const selectStyles = css`
	:host {
		display: inline-block;
		width: 100%;
	}

	gl-select wa-select {
		width: 100%;
	}

	/* Combobox (the visible select control). Use the WA tokens with VS Code fallbacks
	   so consumers can override --wa-form-control-* on the gl-select host (e.g. for
	   action-state colorization in the rebase editor) and the values cascade in. */
	wa-select::part(combobox) {
		min-height: auto;
		padding: 1px 4px;
		font-family: var(--vscode-font-family);
		font-size: inherit;
		line-height: 1.35;
		color: var(--wa-form-control-value-color, var(--vscode-dropdown-foreground));
		background-color: var(--wa-form-control-background-color, var(--vscode-dropdown-background));
		border: var(--wa-form-control-border-width, 1px) var(--wa-form-control-border-style, solid)
			var(--wa-form-control-border-color, var(--vscode-dropdown-border));
		border-radius: var(--wa-form-control-border-radius, 3px);
	}

	wa-select::part(display-input) {
		font-family: var(--vscode-font-family);
		font-size: inherit;
		color: var(--wa-form-control-value-color, var(--vscode-dropdown-foreground));
		field-sizing: content;
	}

	wa-select::part(expand-icon) {
		margin-inline-start: 0.4rem;
	}

	wa-select:focus-within::part(combobox) {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	wa-select[disabled]::part(combobox) {
		color: var(--vscode-disabledForeground);
		cursor: not-allowed;
		background-color: var(--vscode-input-background);
		opacity: 0.6;
	}

	/* Listbox (dropdown menu) */
	wa-select::part(listbox) {
		padding: 4px 0;
		background-color: var(--vscode-dropdown-background);
		border: 1px solid var(--vscode-dropdown-border);
		border-radius: 3px;
		box-shadow: 0 2px 8px rgb(0 0 0 / 15%);
	}

	/* VS Code-style scrollbar for the listbox (we can't apply class="scrollable",
	   so we style via ::part chained with ::-webkit-scrollbar) */
	wa-select::part(listbox)::-webkit-scrollbar {
		width: 10px;
		height: 10px;
	}

	wa-select::part(listbox)::-webkit-scrollbar-corner {
		background-color: transparent;
	}

	wa-select::part(listbox)::-webkit-scrollbar-thumb {
		background-color: var(--vscode-scrollbarSlider-background);
	}

	wa-select::part(listbox)::-webkit-scrollbar-thumb:hover {
		background-color: var(--vscode-scrollbarSlider-hoverBackground);
	}

	wa-select::part(listbox)::-webkit-scrollbar-thumb:active {
		background-color: var(--vscode-scrollbarSlider-activeBackground);
	}

	/* Options — wa-option has no "base" part; the host element IS the styled box.
	   wa-options live inside gl-select's shadow root, so consumer CSS targeting them
	   from outside (e.g. .action-select wa-option { ... }) can't reach them. We expose
	   CSS variables here that consumers override on the gl-select host. */
	wa-option {
		padding: var(--gl-select-option-padding, 4px 8px);
		font-family: var(--vscode-font-family);
		font-size: inherit;
		color: var(--vscode-dropdown-foreground);
		cursor: pointer;
		background-color: transparent;
	}

	wa-option:hover {
		color: var(--gl-select-option-hover-color, var(--vscode-list-hoverForeground));
		background-color: var(--gl-select-option-hover-bg, var(--vscode-list-hoverBackground));
	}

	wa-option:focus {
		color: var(--gl-select-option-focus-color, var(--vscode-list-activeSelectionForeground));
		background-color: var(--gl-select-option-focus-bg, var(--vscode-list-activeSelectionBackground));
	}

	wa-option[aria-selected='true'],
	wa-option[selected] {
		color: var(--gl-select-option-selected-color, var(--vscode-list-activeSelectionForeground));
		background-color: var(--gl-select-option-selected-bg, var(--vscode-list-activeSelectionBackground));
	}

	wa-option[disabled] {
		color: var(--vscode-disabledForeground);
		cursor: not-allowed;
		opacity: 0.6;
	}

	/* Hide the WA built-in checked-icon — we don't use it */
	wa-option::part(checked-icon) {
		display: none;
	}
`;
