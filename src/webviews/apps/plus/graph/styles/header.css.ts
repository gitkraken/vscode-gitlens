import { css } from 'lit';

export const repoHeaderStyles = css`
	.jump-to-ref {
		--button-foreground: var(--color-foreground);
	}

	.merge-conflict-warning {
		flex: 0 0 100%;
		min-width: 0;
	}
`;

export const titlebarStyles = css`
	.titlebar {
		background: var(--titlebar-bg);
		color: var(--titlebar-fg);
		padding: 0.5rem 0.8rem;
		font-size: 1.3rem;
		flex-wrap: wrap;
	}

	:host-context(body[data-placement='panel']) .titlebar {
		border-top: 1px solid transparent;
		border-color: var(--vscode-sideBarSectionHeader-border, transparent);
	}
	.titlebar,
	.titlebar__row,
	.titlebar__group {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.titlebar > *,
	.titlebar__row > *,
	.titlebar__group > * {
		margin: 0;
	}

	.titlebar,
	.titlebar__row {
		justify-content: space-between;
	}

	.titlebar__row {
		flex: 0 0 100%;
		border-top: 1px solid transparent;
		border-bottom: 1px solid transparent;
		margin: -0.5rem -0.8rem;
		padding: 0.5rem 0.8rem;
	}

	.titlebar__row--filtered {
		background: color-mix(in srgb, var(--vscode-statusBarItem-prominentBackground) 18%, transparent);
		border-top-color: color-mix(in srgb, var(--vscode-statusBarItem-prominentBackground) 45%, transparent);
		border-bottom-color: color-mix(in srgb, var(--vscode-statusBarItem-prominentBackground) 30%, transparent);
	}

	.titlebar__row--scoped {
		background: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 18%, transparent);
		border-top-color: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 45%, transparent);
		border-bottom-color: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 30%, transparent);
	}

	.titlebar__row--wrap {
		display: grid;
		grid-auto-flow: column;
		justify-content: start;
		grid-template-columns: 1fr min-content;
	}

	.titlebar__group {
		flex: auto 1 1;
	}

	.titlebar__row--wrap .titlebar__group {
		white-space: nowrap;
	}
	.titlebar__row--wrap .titlebar__group:nth-child(odd) {
		min-width: 0;
	}

	.titlebar__debugging > * {
		display: inline-block;
	}

	.titlebar gl-feature-badge {
		color: var(--color-foreground);
	}
`;

export const graphHeaderControlStyles = css`
	.popover::part(body) {
		padding: 0;
		font-size: var(--vscode-font-size);
		background-color: var(--vscode-menu-background);
	}

	.titlebar__group gl-repo-button-group,
	.titlebar__group gl-ref-button {
		font-size: 1.2rem;
	}

	.shrink {
		max-width: fit-content;
		transition: all 0.2s;
	}
	.shrink.hidden {
		max-width: 0;
		overflow: hidden;
	}
	.titlebar__group .shrink.hidden:not(:first-child) {
		// compensate the parent gap
		margin-left: -0.5rem;
	}

	.branch-menu {
		display: flex;
		gap: 0.5em;
		align-items: center;
	}

	.branch-menu__avatar {
		width: 1.4rem;
		aspect-ratio: 1;
		vertical-align: text-bottom;
	}

	.action-divider {
		display: inline-block;
		width: 0.1rem;
		height: 2.2rem;
		vertical-align: middle;
		background-color: var(--titlebar-fg);
		opacity: 0.4;
		margin: {
			// left: 0.2rem;
			right: 0.2rem;
		}
	}

	.button-group {
		display: flex;
		flex-direction: row;
		align-items: stretch;
	}

	gl-search-box::part(search) {
		--gl-search-input-background: var(--color-graph-actionbar-background);
		--gl-search-input-border: var(--sl-input-border-color);
	}

	sl-option::part(base) {
		padding: 0.2rem 0.4rem;
	}

	sl-option:focus::part(base) {
		background-color: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}

	sl-option:not(:focus):hover::part(base) {
		background-color: var(--vscode-list-inactiveSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}

	sl-option::part(checked-icon) {
		display: none;
	}

	sl-select::part(listbox) {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding-block: 0.2rem 0;
		width: max-content;
	}

	sl-select::part(combobox) {
		--sl-input-background-color: var(--color-graph-actionbar-background);
		--sl-input-color: var(--color-foreground);
		--sl-input-color-hover: var(--color-foreground);
		padding: 0 0.75rem;
		color: var(--color-foreground);
		border-radius: var(--sl-border-radius-small);
	}

	sl-select::part(display-input) {
		field-sizing: content;
	}

	sl-select::part(expand-icon) {
		margin-inline-start: var(--sl-spacing-x-small);
	}

	sl-select[open]::part(combobox) {
		background-color: var(--color-graph-actionbar-background);
	}
	sl-select:hover::part(combobox),
	sl-select:focus::part(combobox) {
		background-color: var(--color-graph-actionbar-selectedBackground);
	}
`;
