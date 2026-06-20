import { css } from 'lit';

export const graphScopePopoverStyles = css`
	:host {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		max-width: 100%;
	}

	.mode-chip {
		display: inline-flex;
		gap: var(--gl-space-4);
		align-items: center;
		min-width: 0;
		max-width: 24rem;
		padding: 0.2rem 0.3rem 0.2rem 0.4rem;
		font: inherit;
		color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
		cursor: pointer;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--gl-radius-sm);
	}

	.mode-chip:hover {
		background: var(--color-graph-actionbar-selectedBackground);
	}

	.mode-chip:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	.mode-chip--filtered {
		color: var(--gl-chip-filtered-text-color);
		background: color-mix(in srgb, var(--gl-chip-filtered-color) var(--gl-chip-tint-bg), transparent);
		border-color: color-mix(in srgb, var(--gl-chip-filtered-color) var(--gl-chip-tint-border), transparent);
	}

	.mode-chip--filtered:hover {
		background: color-mix(in srgb, var(--gl-chip-filtered-color) var(--gl-chip-tint-hover), transparent);
	}

	.mode-chip--scoped {
		color: var(--gl-chip-scoped-text-color);
		background: color-mix(in srgb, var(--gl-chip-scoped-color) var(--gl-chip-tint-bg), transparent);
		border-color: color-mix(in srgb, var(--gl-chip-scoped-color) var(--gl-chip-tint-border), transparent);
	}

	.mode-chip--scoped:hover {
		background: color-mix(in srgb, var(--gl-chip-scoped-color) var(--gl-chip-tint-hover), transparent);
	}

	.mode-chip__icon {
		flex: none;
		font-size: var(--gl-font-lg);
	}

	.mode-chip__label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--gl-font-md);
		white-space: nowrap;
	}

	.mode-chip__chevron {
		flex: none;
		font-size: var(--gl-font-md);
		opacity: 0.7;
	}

	.mode-chip__clear-tooltip {
		display: inline-flex;
		align-items: center;
	}

	.mode-chip__clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		margin-left: var(--gl-space-2);
		color: inherit;
		cursor: pointer;
		border-radius: var(--gl-radius-xs);
		opacity: 0.75;
	}

	.mode-chip__clear:hover,
	.mode-chip__clear:focus-visible {
		outline: none;
		background: color-mix(in srgb, currentcolor 22%, transparent);
		opacity: 1;
	}

	.mode-popover::part(body) {
		min-width: 30rem;
		max-width: 70vw;
	}

	.mode-popover__content {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		padding: var(--gl-space-2) 0;
	}

	.mode-popover__content menu-divider {
		margin-bottom: 0;
	}

	.mode-menu-item {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		padding: 0.3rem 0.8rem;
	}

	.mode-menu-item--current {
		background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 30%, transparent);
	}

	.mode-menu-item--current:hover {
		background: var(--vscode-menu-selectionBackground);
	}

	.mode-menu-item__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.8rem;
		margin-right: 0.5rem;
		font-size: var(--gl-font-lg);
		opacity: 0.9;
	}

	.mode-menu-item__label {
		flex: 1;
		min-width: 0;
		font-size: var(--gl-font-md);
	}

	.mode-menu-item__info {
		font-size: var(--gl-font-md);
		opacity: 0.6;
	}

	.mode-menu-item__info:hover {
		opacity: 1;
	}

	.mode-menu-item__branch {
		flex: 0 1 auto;
		min-width: 0;
		max-width: 16rem;
		margin-right: var(--gl-space-2);
		color: var(--gl-branch-color, var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, inherit));
	}

	.mode-menu-item__chevron {
		flex: none;
		font-size: var(--gl-font-md);
		opacity: 0.7;
	}

	.mode-menu-item--focus {
		cursor: pointer;
	}

	.mode-popover__section-header {
		display: flex;
		gap: var(--gl-space-2);
		align-items: center;
		min-height: 1.8rem;
		padding: 0.2rem 0.8rem 0.1rem;
	}

	.mode-popover__section-title {
		flex: 1;
		font-size: var(--gl-font-micro);
		font-weight: 600;
		color: var(--vscode-menu-foreground, var(--color-foreground));
		text-transform: uppercase;
		letter-spacing: 0.5px;
		opacity: 0.75;
	}

	.mode-popover__section-header gl-button {
		--button-padding: 0.1rem;
		--button-foreground: var(--vscode-menu-foreground, var(--vscode-foreground));
		--button-hover-background: color-mix(in srgb, var(--vscode-menu-foreground) 18%, transparent);

		opacity: 0.5;
	}

	.mode-popover__section-header gl-button.is-active {
		--button-background: var(--vscode-menu-selectionBackground);
		--button-foreground: var(--vscode-menu-selectionForeground);
		--button-hover-background: color-mix(in srgb, var(--vscode-menu-selectionBackground) 80%, #000);

		opacity: 1;
	}

	:host-context(.vscode-light) .mode-popover__section-header gl-button:not(.is-active),
	:host-context(.vscode-high-contrast-light) .mode-popover__section-header gl-button:not(.is-active) {
		opacity: 1;
		--button-background: color-mix(in srgb, var(--vscode-menu-foreground) 25%, transparent);
		--button-foreground: var(--vscode-menu-foreground);
	}

	@media (prefers-color-scheme: light) {
		.mode-popover__section-header gl-button:not(.is-active) {
			opacity: 1;
			--button-background: color-mix(in srgb, var(--vscode-menu-foreground) 25%, transparent);
			--button-foreground: var(--vscode-menu-foreground);
		}
	}

	.mode-popover__checkbox-item {
		display: flex;
		align-items: center;
		min-height: 2.2rem;
		padding: 0.3rem 0.8rem;
		color: var(--vscode-menu-foreground);
		cursor: pointer;
		border-radius: var(--gl-radius-sm);
	}

	.mode-popover__checkbox-item:hover {
		color: var(--vscode-menu-selectionForeground);
		background-color: var(--vscode-menu-selectionBackground);
	}

	.mode-popover__checkbox-item:has(gl-checkbox[disabled]) {
		cursor: default;
	}

	.mode-popover__checkbox-item:has(gl-checkbox[disabled]):hover {
		color: var(--vscode-menu-foreground);
		background-color: transparent;
	}

	.mode-popover__checkbox-item gl-checkbox {
		display: block;
		flex: 1;
		padding: 0;
		margin: 0;
		font-size: var(--gl-font-md);
		--checkbox-foreground: currentcolor;
		--checkbox-background: var(--vscode-checkbox-selectBackground);
		--checkbox-border: var(--vscode-checkbox-selectBorder);
		--checkbox-hover-background: var(--vscode-checkbox-selectBackground);
	}

	.mode-popover__focus-pane {
		display: flex;
		flex: 1 1 24rem;
		flex-direction: column;
		min-height: 12rem;
		overflow: hidden;
		border-top: 1px solid var(--vscode-menu-separatorBackground, color-mix(in srgb, currentColor 15%, transparent));
	}

	.mode-popover__branches {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 10rem;
		overflow: hidden;
	}

	.mode-popover__tree {
		flex: 1;
		height: 100%;
		min-height: 0;
		--gitlens-gutter-width: 0.8rem;
	}

	.mode-popover__empty {
		padding: var(--gl-space-8) var(--gl-space-12);
		font-style: italic;
		color: var(--color-foreground--65);
	}

	.mode-popover__empty--retry {
		display: flex;
		gap: var(--gl-space-4);
		align-items: center;
	}
`;
