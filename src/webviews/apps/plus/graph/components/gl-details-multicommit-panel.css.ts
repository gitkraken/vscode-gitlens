import { css } from 'lit';

export { panelActionInputStyles, panelHostStyles } from './shared-panel.css.js';

export const multiCommitPanelStyles = css`
	:host {
		--mode-header-bg: var(--gl-color-surface-aside);
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
		border-top: var(--gl-border-width) solid var(--gl-color-divider-base);
		border-bottom: var(--gl-border-width) solid var(--gl-color-divider-base);
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
		color: var(--vscode-descriptionForeground);
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
		font-size: var(--gl-font-md);
		color: var(--vscode-descriptionForeground);
		white-space: nowrap;
	}

	.compare-metadata__right .mode-status__group {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
	}

	/* Active AI model name in the generating snippet — the gl-tooltip carries the full "provider · model". */
	.compare-metadata__right .mode-status__model {
		cursor: help;
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
		color: var(--gl-color-action-quiet-fg);
		background: var(--gl-color-action-quiet-bg-hover);
	}

	/* High-contrast hover cue; toolbar.hoverOutline is unset outside HC. Not while focused, so the focus ring wins */
	.compare-metadata__right .mode-status__resume:not(:disabled, :focus-visible):hover {
		outline: var(--gl-border-width) dashed var(--gl-color-action-quiet-outline-hover);
		outline-offset: -1px;
	}

	.compare-metadata__right .mode-status__resume:focus-visible {
		color: var(--gl-color-action-quiet-fg);
		outline: var(--gl-border-width) solid var(--gl-color-border-focus);
		outline-offset: -0.1rem;
		background: var(--gl-color-action-quiet-bg-hover);
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

	/* Pole card = the shared gl-commit-row-item (row + hover popover + signature). Match the panel's
	   denser row padding; all interaction/popover styling lives in the component. */
	.pole-card {
		--gl-commit-row-item-padding-block: 0.55rem;
		--gl-commit-row-item-padding-inline: 1.2rem;
	}

	.pole-card--loading {
		padding: var(--gl-space-8) var(--gl-space-12);
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
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
		background: var(--gl-color-divider-base);
	}

	.compare-middle__count {
		position: absolute;
		right: 1.2rem;
		max-width: calc(50% - 2.4rem);
		padding-left: 0.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		white-space: nowrap;
	}

	.compare-middle__swap {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		/* Outer size, padding and border included, so the 1.6rem icon keeps its inset relief. */
		width: 3rem;
		height: 2.4rem;
		padding: 0.3rem 0.6rem;
		color: var(--vscode-descriptionForeground);
		cursor: pointer;
		background: var(--color-background--level-10);
		border: var(--gl-border-width) solid var(--gl-color-action-secondary-border);
		border-radius: var(--gl-radius-sm);
	}

	.compare-middle__swap code-icon {
		transform: rotate(90deg);
	}

	.compare-middle__swap:hover {
		color: var(--color-foreground);
		background: var(--gl-color-action-quiet-bg-hover);
		border-color: var(--vscode-descriptionForeground);
	}

	/* High-contrast hover cue; toolbar.hoverOutline is unset outside HC. Not while focused, so the focus ring wins */
	.compare-middle__swap:not(:disabled, :focus-visible):hover {
		outline: var(--gl-border-width) dashed var(--gl-color-action-quiet-outline-hover);
		outline-offset: -1px;
	}

	/* Multi-select strip wraps onto more rows; the compare panel's stays single-row. */
	.compare-enrichment {
		flex-wrap: wrap;
	}

	.compare-section {
		display: flex;
		flex: none;
		flex-direction: column;
		padding-bottom: var(--gl-space-4);
		border-bottom: var(--gl-border-width) solid var(--gl-color-divider-base);
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
		color: var(--vscode-descriptionForeground);
	}
`;
