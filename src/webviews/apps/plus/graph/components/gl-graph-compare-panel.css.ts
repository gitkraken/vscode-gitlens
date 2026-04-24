import { css } from 'lit';

export { panelActionInputStyles, panelHostStyles } from './shared-panel.css.js';

export const comparePanelStyles = css`
	.compare-header__title {
		font-weight: 500;
		font-size: var(--gl-font-base);
		color: var(--color-foreground--85);
	}

	.compare-metadata {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem var(--gl-panel-padding-right, 1.2rem) 0.4rem var(--gl-panel-padding-left, 1.2rem);
		gap: 0.6rem;
		flex: none;
		font-size: var(--gl-font-sm);
		background-color: color-mix(in srgb, var(--color-background) 95%, var(--color-foreground) 5%);
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	.compare-metadata__left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.compare-metadata__sha {
		flex-shrink: 0;
		font-size: var(--gl-font-base);
	}

	.compare-metadata__dots {
		color: var(--color-foreground--50);
		font-family: var(--vscode-editor-font-family, monospace);
	}

	.compare-metadata__right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.compare-poles {
		display: flex;
		flex-direction: column;
		flex: none;
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	.pole-card__popover {
		display: block;
		--gl-popover-anchor-width: 100%;
	}

	/* Pole card wraps the shared gl-commit-row in a hover-popover anchor with optional signature
	   badge. The row owns its own avatar + headline + meta layout — the card just frames it and
	   handles the popover/signature concerns. */
	.pole-card {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 1.2rem;
		cursor: pointer;
		min-width: 0;
	}

	.pole-card:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.pole-card:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	.pole-card--loading {
		padding: 0.8rem 1.2rem;
		color: var(--color-foreground--50);
		font-size: var(--gl-font-sm);
	}

	.pole-card > gl-commit-row {
		flex: 1;
		min-width: 0;
	}

	.pole-card__signature {
		flex-shrink: 0;
	}

	.compare-middle {
		display: flex;
		align-items: center;
		position: relative;
		padding: 0 1.2rem;
		max-height: 1.6rem;
	}

	.compare-middle__line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
	}

	.compare-middle__rule {
		flex: 1;
		height: 1px;
		background: var(--vscode-sideBarSectionHeader-border);
	}

	.compare-middle__count {
		position: absolute;
		right: 1.2rem;
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--50);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: calc(50% - 24px);
		padding-left: 0.5rem;
	}

	.compare-middle__swap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border: 1px solid var(--vscode-sideBarSectionHeader-border);
		background: var(--color-background--level-10);
		color: var(--color-foreground--65);
		cursor: pointer;
		border-radius: 4px;
		flex-shrink: 0;
		padding: 0.3rem 0.6rem;
	}

	.compare-middle__swap code-icon {
		transform: rotate(90deg);
	}

	.compare-middle__swap:hover {
		background: var(--vscode-toolbar-hoverBackground);
		color: var(--color-foreground);
		border-color: var(--color-foreground--50);
	}

	.compare-enrichment {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.4rem 1.2rem 0.4rem 1.2rem;
		font-size: var(--gl-font-sm);
		flex: none;
	}

	.compare-enrichment gl-action-chip[data-action='autolink-settings'] {
		color: var(--color-foreground--65);
		--code-icon-size: 12px;
	}

	.compare-enrichment gl-action-chip::part(base) {
		gap: 0.4rem;
	}

	.compare-enrichment gl-action-chip::part(icon) {
		line-height: 1;
		display: inline-flex;
		align-items: center;
	}

	.pole-popover {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0.6rem 0.2rem 0.2rem 0.2rem;
		max-width: 400px;
	}

	.pole-popover__header {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.pole-popover__info {
		display: flex;
		gap: 0.625rem;
		align-items: center;
		flex: 1;
		min-width: 0;
	}

	.pole-popover__avatar {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		flex-shrink: 0;
	}

	.pole-popover__details {
		display: flex;
		flex-direction: column;
		gap: 0;
		min-width: 0;
		flex: 1;
		line-height: normal;
	}

	.pole-popover__name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--vscode-foreground);
	}

	.pole-popover__email {
		font-weight: 400;
		color: var(--vscode-descriptionForeground);
	}

	.pole-popover__email a {
		color: var(--color-link-foreground);
		text-decoration: none;
	}

	.pole-popover__message {
		font-size: var(--gl-font-base);
		color: var(--color-foreground--85);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 10rem;
		overflow: auto;
	}

	.pole-popover__date {
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--50);
		flex-shrink: 0;
		white-space: nowrap;
	}

	.compare-files {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 12rem;
		overflow: hidden;
		margin-top: 0.4rem;
		padding-left: 0.6rem;
		padding-right: 0.6rem;
	}

	.compare-files webview-pane-group {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.details-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		color: var(--color-foreground--50);
		font-size: var(--gl-font-base);
	}
`;
