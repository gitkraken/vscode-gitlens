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
		padding: 0.6rem 0.8rem;
		font-size: 1.3rem;
		flex-wrap: wrap;
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
	.button-group:hover,
	.button-group:focus-within {
		background-color: var(--color-graph-actionbar-selectedBackground);
		border-radius: 3px;
	}

	.button-group > *:not(:first-child),
	.button-group > *:not(:first-child) .action-button {
		display: flex;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
	.button-group > *:not(:first-child) .action-button {
		padding-left: 0.5rem;
		padding-right: 0.5rem;
		height: 100%;
	}

	.button-group:hover > *:not(:last-child),
	.button-group:active > *:not(:last-child),
	.button-group:focus-within > *:not(:last-child),
	.button-group:hover > *:not(:last-child) .action-button,
	.button-group:active > *:not(:last-child) .action-button,
	.button-group:focus-within > *:not(:last-child) .action-button {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}

	.minimap-marker-swatch {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		border-radius: 2px;
		transform: scale(1.6);
		margin-left: 0.3rem;
		margin-right: 1rem;
	}

	.minimap-marker-swatch[data-marker='localBranches'] {
		background-color: var(--color-graph-minimap-marker-local-branches);
	}

	.minimap-marker-swatch[data-marker='pullRequests'] {
		background-color: var(--color-graph-minimap-marker-pull-requests);
	}

	.minimap-marker-swatch[data-marker='remoteBranches'] {
		background-color: var(--color-graph-minimap-marker-remote-branches);
	}

	.minimap-marker-swatch[data-marker='stashes'] {
		background-color: var(--color-graph-minimap-marker-stashes);
	}

	.minimap-marker-swatch[data-marker='tags'] {
		background-color: var(--color-graph-minimap-marker-tags);
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
