import { css } from 'lit';

export { panelActionInputStyles, panelHostStyles } from './shared-panel.css.js';

export const multiCommitPanelStyles = css`
	:host {
		--mode-header-bg: var(--titlebar-bg, var(--vscode-sideBar-background, var(--color-background)));
	}

	.compare-metadata {
		display: flex;
		flex: none;
		gap: var(--gl-space-6);
		align-items: center;
		justify-content: space-between;
		min-height: var(--gl-metadata-bar-min-height);
		padding: 0 var(--gl-panel-padding-right, 1.2rem) 0 var(--gl-panel-padding-left, 1.2rem);
		font-size: var(--gl-font-sm);
		background-color: var(--gl-metadata-bar-bg);
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	.compare-metadata__left {
		display: flex;
		flex: 1;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
		overflow: hidden;
	}

	.compare-metadata__sha {
		flex-shrink: 0;
		font-size: var(--gl-font-base);
	}

	.compare-metadata__dots {
		font-family: var(--vscode-editor-font-family, monospace);
		color: var(--color-foreground--50);
	}

	.compare-metadata__right {
		display: flex;
		flex-shrink: 0;
		gap: var(--gl-space-4);
		align-items: center;
	}

	/* Mode-status snippet — replaces commit-stats in the metadata bar's right side while in
	   review on a multi-commit anchor. */
	.compare-metadata__right .mode-status {
		display: inline-flex;
		gap: var(--gl-space-8);
		align-items: center;
		font-size: var(--gl-font-small, 1.2rem);
		color: var(--color-foreground--65);
		white-space: nowrap;
	}

	.compare-metadata__right .mode-status__group {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
	}

	.compare-metadata__right .mode-status__group code-icon {
		--code-icon-size: 1.2rem;
		--code-icon-v-align: text-bottom;

		opacity: 0.85;
	}

	.compare-metadata__right .mode-status__resume {
		display: inline-flex;
		gap: var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-2) var(--gl-space-6);
		font: inherit;
		color: inherit;
		cursor: pointer;
		background: transparent;
		border: none;
		border-radius: var(--gl-radius-sm);
	}

	.compare-metadata__right .mode-status__resume:hover {
		color: var(--vscode-foreground);
		background: var(--vscode-toolbar-hoverBackground);
	}

	.compare-metadata__right .mode-status__resume:focus-visible {
		color: var(--vscode-foreground);
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
		background: var(--vscode-toolbar-hoverBackground);
	}

	.compare-metadata__right .mode-status__resume-verb {
		font-weight: 500;
	}

	.compare-metadata__right .mode-status__resume-arrow {
		--code-icon-size: 1.2rem;
		--code-icon-v-align: text-bottom;

		opacity: 0.85;
	}

	.compare-poles {
		display: flex;
		flex: none;
		flex-direction: column;
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
		gap: var(--gl-space-4);
		align-items: center;
		min-width: 0;
		padding: 0.55rem 1.2rem;
		cursor: pointer;
	}

	.pole-card:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.pole-card:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	.pole-card--loading {
		padding: var(--gl-space-8) var(--gl-space-12);
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--50);
	}

	.pole-card > gl-commit-row {
		flex: 1;
		min-width: 0;
	}

	.pole-card__signature {
		flex-shrink: 0;
	}

	.compare-middle {
		position: relative;
		display: flex;
		align-items: center;
		max-height: 1.6rem;
		padding: 0 var(--gl-space-12);
	}

	.compare-middle__line {
		display: flex;
		flex: 1;
		gap: 0.5rem;
		align-items: center;
	}

	.compare-middle__rule {
		flex: 1;
		height: 1px;
		background: var(--vscode-sideBarSectionHeader-border);
	}

	.compare-middle__count {
		position: absolute;
		right: 1.2rem;
		max-width: calc(50% - 2.4rem);
		padding-left: 0.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--50);
		white-space: nowrap;
	}

	.compare-middle__swap {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		padding: 0.3rem 0.6rem;
		color: var(--color-foreground--65);
		cursor: pointer;
		background: var(--color-background--level-10);
		border: 0.1rem solid var(--vscode-sideBarSectionHeader-border);
		border-radius: var(--gl-radius-sm);
	}

	.compare-middle__swap code-icon {
		transform: rotate(90deg);
	}

	.compare-middle__swap:hover {
		color: var(--color-foreground);
		background: var(--vscode-toolbar-hoverBackground);
		border-color: var(--color-foreground--50);
	}

	.compare-enrichment {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
		padding: var(--gl-space-4) var(--gl-space-12);
		font-size: var(--gl-font-sm);
	}

	.compare-enrichment gl-action-chip[data-action='autolink-settings'] {
		color: var(--color-foreground--65);
		--code-icon-size: 1.2rem;
	}

	.compare-enrichment gl-action-chip::part(base) {
		gap: var(--gl-space-4);
	}

	.compare-enrichment gl-action-chip::part(icon) {
		display: inline-flex;
		align-items: center;
		line-height: 1;
	}

	/* Inline autolinks loading state — replaces "No autolinks found" while the comparison
	   identity (commits) is changing. min-height matches gl-action-chip's intrinsic 2rem so
	   the strip doesn't jump between the spinner and the chip-based states. */
	.compare-enrichment__loading {
		display: inline-flex;
		gap: var(--gl-space-4);
		align-items: center;
		min-height: 2rem;
		color: var(--vscode-descriptionForeground);
	}

	.pole-popover {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 400px;
		margin: var(--gl-space-6) var(--gl-space-2) var(--gl-space-2);
	}

	.pole-popover__header {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.pole-popover__info {
		display: flex;
		flex: 1;
		gap: 0.625rem;
		align-items: center;
		min-width: 0;
	}

	.pole-popover__avatar {
		flex-shrink: 0;
		width: 3.2rem;
		height: 3.2rem;
		border-radius: var(--gl-radius-lg);
	}

	.pole-popover__details {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0;
		min-width: 0;
		line-height: normal;
	}

	.pole-popover__name {
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
		color: var(--vscode-foreground);
		white-space: nowrap;
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
		max-height: 10rem;
		overflow: auto;
		font-size: var(--gl-font-base);
		color: var(--color-foreground--85);
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	/* Pole popover content is portaled by gl-popover (hoist), so scrollableBase's
	   :host(:hover) gate never matches when the user is hovering the popover.
	   Force the scrollbar slider to be visible via the same border-color trick the
	   shared mixin uses, so future tweaks to scrollbar slider colors flow through. */
	.pole-popover__message.scrollable {
		border-color: var(--vscode-scrollbarSlider-background);
	}

	.pole-popover__message.scrollable::-webkit-scrollbar-thumb:hover {
		border-color: var(--vscode-scrollbarSlider-hoverBackground);
	}

	.pole-popover__message.scrollable::-webkit-scrollbar-thumb:active {
		border-color: var(--vscode-scrollbarSlider-activeBackground);
	}

	.pole-popover__date {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--50);
		white-space: nowrap;
	}

	.compare-section {
		display: flex;
		flex: none;
		flex-direction: column;
		padding-bottom: var(--gl-space-4);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	.compare-files {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 12rem;
		padding-right: var(--gl-space-6);
		padding-left: var(--gl-space-6);
		overflow: hidden;
	}

	.compare-files webview-pane-group {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* File-section loading container — sits in the gl-file-tree-pane "before-tree" slot in place
	   of the "No Files" empty text while the comparison diff is still being fetched. */
	.compare-files--loading {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		justify-content: center;
		padding: var(--gl-space-20) var(--gl-space-12);
		color: var(--vscode-descriptionForeground);
		text-align: center;
	}

	.details-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--gl-space-20);
		font-size: var(--gl-font-base);
		color: var(--color-foreground--50);
	}
`;
