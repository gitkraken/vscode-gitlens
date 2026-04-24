import { css } from 'lit';

export const scopePopoverStyles = css`
	:host {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		max-width: 100%;
	}

	.mode-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.3rem 0.2rem 0.4rem;
		background: var(--color-graph-actionbar-background);
		color: var(--color-foreground);
		border: 1px solid transparent;
		border-radius: 0.3rem;
		font: inherit;
		cursor: pointer;
		max-width: 24rem;
		min-width: 0;
	}
	.mode-chip:hover {
		background: var(--color-graph-actionbar-selectedBackground);
	}
	.mode-chip:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	.mode-chip--filtered {
		background: color-mix(in srgb, var(--vscode-statusBarItem-prominentBackground) 30%, transparent);
		color: var(--vscode-statusBarItem-prominentForeground, var(--vscode-foreground));
		border-color: color-mix(in srgb, var(--vscode-statusBarItem-prominentBackground) 55%, transparent);
	}
	.mode-chip--filtered:hover {
		background: color-mix(in srgb, var(--vscode-statusBarItem-prominentBackground) 42%, transparent);
	}

	.mode-chip--scoped {
		background: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 30%, transparent);
		color: var(--vscode-statusBarItem-warningForeground, var(--vscode-foreground));
		border-color: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 55%, transparent);
	}
	.mode-chip--scoped:hover {
		background: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 42%, transparent);
	}

	.mode-chip__icon {
		flex: none;
		font-size: 1.4rem;
	}

	.mode-chip__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1.2rem;
		min-width: 0;
	}

	.mode-chip__chevron {
		flex: none;
		opacity: 0.7;
		font-size: 1.2rem;
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
		border-radius: 0.2rem;
		margin-left: 0.2rem;
		color: inherit;
		opacity: 0.75;
		cursor: pointer;
	}
	.mode-chip__clear:hover,
	.mode-chip__clear:focus-visible {
		background: color-mix(in srgb, currentColor 22%, transparent);
		opacity: 1;
		outline: none;
	}

	.mode-popover::part(body) {
		min-width: 30rem;
		max-width: 70vw;
	}

	.mode-popover__content {
		display: flex;
		flex-direction: column;
		padding: 0.2rem 0;
		min-height: 0;
		flex: 1 1 auto;
	}

	.mode-popover__content menu-divider {
		margin-bottom: 0;
	}

	.mode-menu-item {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.8rem;
	}

	.mode-menu-item--current {
		background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 30%, transparent);
	}

	.mode-menu-item__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.8rem;
		font-size: 1.4rem;
		margin-right: 0.5rem;
		opacity: 0.9;
	}

	.mode-menu-item__label {
		font-size: 1.2rem;
		flex: 1;
		min-width: 0;
	}

	.mode-menu-item__info {
		font-size: 1.2rem;
		opacity: 0.6;
	}
	.mode-menu-item__info:hover {
		opacity: 1;
	}

	.mode-menu-item__branch {
		flex: 0 1 auto;
		min-width: 0;
		max-width: 16rem;
		margin-right: 0.2rem;
		color: var(--gl-branch-color, var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, inherit));
	}

	.mode-menu-item__chevron {
		flex: none;
		font-size: 1.2rem;
		opacity: 0.7;
	}

	.mode-menu-item--focus {
		cursor: pointer;
	}

	.mode-popover__section-header {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.2rem 0.8rem 0.1rem;
		min-height: 1.8rem;
	}
	.mode-popover__section-title {
		flex: 1;
		color: var(--color-foreground--75);
		font-size: 1rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.mode-popover__section-header gl-button {
		--button-padding: 0.1rem;
	}
	.mode-popover__section-header gl-button.is-active {
		--button-background: color-mix(in srgb, var(--vscode-statusBarItem-prominentBackground) 22%, transparent);
		--button-foreground: var(--vscode-statusBarItem-prominentForeground, var(--vscode-foreground));
	}

	.mode-popover__checkbox-item {
		padding: 0 0.8rem;
	}
	.mode-popover__checkbox-item gl-checkbox {
		display: block;
		font-size: 1.2rem;
		line-height: 1.6rem;
		padding: 0.1rem 0;
		margin-block: 0.4rem;
		--checkbox-foreground: var(--vscode-menu-foreground, var(--color-foreground));
		--checkbox-checked-foreground: var(--vscode-menu-foreground, var(--color-foreground));
	}

	.mode-popover__focus-pane {
		display: flex;
		flex-direction: column;
		flex: 1 1 24rem;
		min-height: 12rem;
		overflow: hidden;
		border-top: 1px solid var(--vscode-menu-separatorBackground, color-mix(in srgb, currentColor 15%, transparent));
	}

	.mode-popover__branches {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 10rem;
		overflow: hidden;
	}

	.mode-popover__tree {
		flex: 1;
		min-height: 0;
		height: 100%;
		--gitlens-gutter-width: 0.8rem;
	}

	.mode-popover__empty {
		padding: 0.8rem 1.2rem;
		color: var(--color-foreground--65);
		font-style: italic;
	}
`;
