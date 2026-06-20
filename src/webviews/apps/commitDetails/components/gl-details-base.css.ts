import { css } from 'lit';
import {
	elementBase,
	metadataBarVarsBase,
	scrollableBase,
	subPanelEnterStyles,
} from '../../shared/components/styles/lit/base.css.js';

export const detailsBaseStyles = [
	elementBase,
	scrollableBase,
	subPanelEnterStyles,
	metadataBarVarsBase,
	css`
		:host {
			display: contents;
		}

		.commit-stats-subtitle {
			opacity: 1;
		}

		a {
			text-decoration: none;
		}

		a:hover {
			text-decoration: underline;
		}

		.compare-header__title {
			display: inline-flex;
			gap: 0.5rem;
			align-items: center;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			font-size: var(--gl-font-base);
			font-weight: 500;
			color: var(--color-foreground--85);
			white-space: nowrap;
		}

		.compare-header__mode-icon {
			flex: 0 0 auto;
			color: var(--mode-accent, var(--vscode-foreground));
		}

		/* Section layout */
		.section {
			padding: 0 var(--gitlens-scrollbar-gutter-width) 1.5rem var(--gitlens-gutter-width);
		}

		.section:first-child {
			padding-top: 0.8rem;
		}

		.section > :first-child {
			margin-top: 0;
		}

		.section > :last-child {
			margin-bottom: 0;
		}

		.section--message {
			padding: 0 var(--gitlens-scrollbar-gutter-width) 1rem var(--gitlens-scrollbar-gutter-width);
		}

		.section--empty > :last-child {
			margin-top: 0.5rem;
		}

		.section--skeleton {
			padding-top: 1px;
			padding-bottom: 1px;
		}

		.section--actions {
			padding: 0 var(--gitlens-scrollbar-gutter-width) 0 var(--gitlens-gutter-width);
		}

		/* Message block */
		.message-block {
			position: relative;
			padding: 0.5rem;
			font-size: var(--gl-font-base);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: var(--gl-radius-xs) var(--gl-radius-xs) 0 0;
		}

		.message-block__text {
			max-height: 9rem;
			margin: 0;
			overflow: hidden auto;
		}

		.message-block__text strong {
			font-size: var(--gl-font-lg);
			font-weight: 600;
		}

		.message-block__copy {
			position: absolute;
			right: 0;
			bottom: 0.4rem;
			z-index: 1;
			color: var(--vscode-descriptionForeground);
			opacity: 0.7;
			transition: opacity 0.15s ease;
		}

		.message-block__copy:hover,
		.message-block__copy:focus-within {
			color: var(--vscode-foreground);
			opacity: 1;
		}

		/* Message block rows (actions bar below message) */
		.message-block-row,
		.message-block-group {
			display: flex;
			flex-direction: row;
			gap: 0.6rem;
		}

		.message-block-row {
			justify-content: space-between;
		}

		.message-block-row--actions {
			padding: 0.2rem;
			font-size: var(--gl-font-base);
			color: var(--color-foreground--65);
			background: var(--color-background--level-075);
		}

		.message-block-row--actions:last-child {
			border-radius: 0 0 var(--gl-radius-xs) var(--gl-radius-xs);
		}

		.message-block-row--actions:first-of-type:last-child {
			border-radius: var(--gl-radius-xs);
		}

		.message-block-row--actions gl-action-chip::part(icon),
		.message-block-row--actions gl-autolink-chip::part(icon),
		.message-block-row--actions gl-commit-date {
			--code-icon-size: 1.3rem;
		}

		/* Inline autolinks loading state — replaces "No autolinks found" while the commit
	   identity (sha) is changing. min-height matches gl-action-chip's intrinsic 2rem so
	   the strip doesn't jump between the spinner and the chip-based states. */
		.autolinks-loading {
			display: inline-flex;
			gap: 0.4rem;
			align-items: center;
			min-height: 2rem;
			color: var(--vscode-descriptionForeground);
		}

		/* File-section loading container — sits in the gl-file-tree-pane "before-tree" slot in
	   place of the "No Files" empty text while the embedded panel is showing a "lite" commit
	   shell waiting for the full fetch. */
		.files-loading {
			display: flex;
			gap: 0.6rem;
			align-items: center;
			justify-content: center;
			padding: 2rem 1.2rem;
			color: var(--vscode-descriptionForeground);
			text-align: center;
		}

		.message-block-row--actions .reachability-summary code-icon,
		.message-block-row--actions .reachability-summary gl-action-chip::part(icon) {
			--code-icon-size: 12px;
		}

		.message-block-row--actions gl-commit-date {
			margin-inline-end: 0.2rem;
		}

		.message-block-row--actions gl-action-chip.error {
			background-color: var(--color-alert-errorBackground);
		}

		.message-block-row--actions gl-action-chip.warning {
			background-color: var(--color-alert-warningHoverBackground);
		}

		/* Reachability styles */
		.reachability-summary {
			display: flex;
			flex: 1 1 0;
			flex-wrap: wrap;
			gap: 0.6rem;
			align-items: center;
			min-width: 0;
			overflow: hidden;
		}

		.reachability-summary code-icon,
		.reachability-summary gl-action-chip::part(icon) {
			--code-icon-size: 12px;
		}

		.reachability-summary gl-action-chip::part(base) {
			overflow: hidden;
		}

		.reachability-range-chip-wrapper {
			display: inline-flex;
			min-width: 0;
			max-width: 100%;
			overflow: hidden;
		}

		@media (width <= 768px) {
			.reachability-range-chip-wrapper {
				flex: 1 1 100%;
			}
		}

		.reachability-range-chip {
			display: inline-flex !important;
			width: auto;
			min-width: 0;
			max-width: 100%;
			padding: 0.1rem 0.25rem;
			overflow: hidden;
			color: var(--color-foreground--65);
			border-radius: var(--gl-radius-sm);
			--chip-text-transform: none;
			--chip-background: transparent;
		}

		.reachability-range-chip:hover,
		.reachability-range-chip:focus {
			opacity: 1;
		}

		.reachability-range-chip--range {
			cursor: pointer;
		}

		.reachability-range-chip--local-branch {
			font-weight: 600;
			color: var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, #4ec9b0);
		}

		.reachability-range-chip--remote-branch {
			color: var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, #4ec9b0);
		}

		.reachability-range-chip--tag {
			color: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 70%, var(--color-foreground) 30%);
		}

		.reachability-range-chip--current .reachability-range-chip__label {
			font-weight: 600;
		}

		.reachability-range-chip__label {
			flex: 1 1 auto;
			min-width: 0;
			max-width: 100%;
			padding-left: 0.25rem;
			overflow: hidden;
			text-overflow: ellipsis;
			font-size: inherit;
			white-space: nowrap;
		}

		.reachability-range-chip__label code-icon {
			margin-right: 0.2rem;
			vertical-align: middle;
		}

		.reachability-range-chip__ellipsis {
			padding: 0 0.4rem;
			opacity: 0.8;
		}

		.reachability-range-chip__count {
			padding-left: 0.4rem;
			font-size: var(--gl-font-micro);
			font-weight: 600;
			color: var(--color-foreground--50);
		}

		.reachability-popover {
			min-width: 200px;
			max-width: 400px;
		}

		.reachability-popover__header {
			padding-bottom: 0.6rem;
			font-weight: 500;
		}

		.reachability-popover__list {
			display: flex;
			flex-direction: column;
			gap: 0.2rem;
			max-height: 300px;
			overflow-y: auto;
		}

		.reachability-list-item {
			display: flex;
			gap: 0.5rem;
			align-items: center;
			padding: 0.3rem 0.4rem;
			font-size: var(--gl-font-base);
			line-height: 1.4;
		}

		.reachability-list-item--current {
			font-weight: 600;
		}

		.reachability-list-item__icon {
			flex-shrink: 0;
			opacity: 0.8;
			--code-icon-size: 14px;
		}

		.reachability-list-item__label {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* Media query hiding */
		@media (width <= 300px) {
			.mq-hide-sm {
				display: none !important;
			}
		}

		/* Button styles */
		.button--busy[aria-busy='true'] {
			opacity: 0.5;
		}

		.button--busy:not([aria-busy='true']) code-icon {
			display: none;
		}

		.button-container {
			max-width: 30rem;
			margin: 1rem auto 0;
			text-align: left;
			transition: max-width 0.2s ease-out;
		}

		@media (width >= 640px) {
			.button-container {
				max-width: 100%;
			}
		}

		.button-group {
			display: inline-flex;
			gap: 0.1rem;
		}

		.button-group--single {
			width: 100%;
			max-width: 30rem;
		}

		.button-group > *:not(:first-child),
		.button-group > *:not(:first-child) gl-button {
			border-top-left-radius: 0;
			border-bottom-left-radius: 0;
		}

		.button-group > *:not(:last-child),
		.button-group > *:not(:last-child) gl-button {
			border-top-right-radius: 0;
			border-bottom-right-radius: 0;
		}

		/* AI content */
		.ai-content {
			padding: 0.5rem;
			margin-top: 1rem;
			font-size: var(--gl-font-base);
			background: var(--vscode-input-background);
			border: 0.1rem solid var(--vscode-input-border, transparent);
			border-radius: var(--gl-radius-xs);
		}

		.ai-content.has-error {
			padding-left: 0.8rem;
			border-left-color: var(--color-alert-errorBorder);
			border-left-width: 0.3rem;
		}

		.ai-content:empty {
			display: none;
		}

		.ai-content__summary {
			display: block;
			max-height: 20rem;
			margin: 0;
			overflow: hidden auto;
		}

		/* Popover content */
		.popover-content {
			padding: 0.8rem 1.2rem;
			background-color: var(--color-background--level-15);
		}

		/* Alert */
		.alert {
			box-sizing: border-box;
			display: flex;
			gap: 0.6rem;
			align-items: center;
			width: 100%;
			max-width: 100%;
			padding: 0.4rem 0.8rem;
			margin-block: 0;
			color: var(--color-alert-warningForeground, var(--vscode-input-foreground));
			background-color: var(--color-alert-warningBackground);
			border: 1px solid var(--color-alert-warningBorder);
			border-radius: var(--gl-radius-sm);
		}

		.alert code-icon {
			flex: none;
			--code-icon-size: 13px;
		}

		.alert__content {
			flex: 1;
			min-width: 0;
			margin: 0;
			font-size: var(--gl-font-base);
			line-height: 1.4;
		}

		/* Inline popover / tooltip hint */
		.inline-popover {
			display: inline-block;
		}

		.tooltip-hint {
			white-space: nowrap;
			border-bottom: 1px dashed currentcolor;
		}

		/* Child component layout — these live inside the shadow root */
		webview-pane-group {
			flex: 1;
			height: 100%;
			min-height: 0;
			overflow: hidden;
		}

		webview-pane {
			display: flex;
			flex-direction: column;
			min-height: 0;
		}

		webview-pane[flexible] {
			flex: 1;
			overflow: hidden;
		}
	`,
	// Embedded split-panel handle (used by both gl-details-commit-panel and gl-details-wip-panel)
	css`
		:host([variant='embedded']) .split__handle {
			position: relative;
			z-index: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			border-top: 1px solid color-mix(in srgb, var(--vscode-sideBarSectionHeader-border) 60%, transparent);
		}

		:host([variant='embedded']) .split__handle::after {
			position: relative;
			top: -0.3rem;
			width: 7rem;
			height: 0.3rem;
			content: '';
			background-color: color-mix(in srgb, var(--color-foreground) 55%, var(--color-background));
			border-radius: var(--gl-radius-xs);
			transition: background-color 0.15s ease;
		}

		:host([variant='embedded']) .split__handle:hover::after,
		:host([variant='embedded']) .split[dragging] .split__handle::after {
			background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
		}

		:host([variant='embedded']) gl-badge {
			font-size: var(--gl-font-micro);
		}
	`,
];
