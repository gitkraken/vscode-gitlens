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

		a {
			text-decoration: none;
		}
		a:hover {
			text-decoration: underline;
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
			font-size: var(--gl-font-base);
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			padding: 0.5rem;
			border-radius: 0.2rem 0.2rem 0 0;
		}

		.message-block__text {
			margin: 0;
			overflow-y: auto;
			overflow-x: hidden;
			max-height: 9rem;
		}
		.message-block__text strong {
			font-weight: 600;
			font-size: var(--gl-font-lg);
		}

		.message-block__copy {
			position: absolute;
			bottom: 0.4rem;
			right: 0;
			z-index: 1;
			opacity: 0.7;
			transition: opacity 0.15s ease;
			color: var(--vscode-descriptionForeground);
		}
		.message-block__copy:hover,
		.message-block__copy:focus-within {
			opacity: 1;
			color: var(--vscode-foreground);
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
			font-size: var(--gl-font-base);
			color: var(--color-foreground--65);
			background: var(--color-background--level-075);
			padding: 0.2rem;
		}
		.message-block-row--actions:last-child {
			border-radius: 0 0 0.2rem 0.2rem;
		}
		.message-block-row--actions:first-of-type:last-child {
			border-radius: 0.2rem;
		}

		.message-block-row--actions gl-action-chip::part(icon),
		.message-block-row--actions gl-autolink-chip::part(icon),
		.message-block-row--actions gl-commit-date {
			--code-icon-size: 1.3rem;
		}

		/* Inline autolinks loading state — replaces "No autolinks found" while the commit
		   identity (sha) is changing. */
		.autolinks-loading {
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
			color: var(--vscode-descriptionForeground);
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
			flex-wrap: wrap;
			gap: 0.6rem;
			align-items: center;
			overflow: hidden;
			flex: 1 1 0;
			min-width: 0;
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
			max-width: 100%;
			min-width: 0;
			overflow: hidden;
		}
		@media (max-width: 768px) {
			.reachability-range-chip-wrapper {
				flex: 1 1 100%;
			}
		}

		.reachability-range-chip {
			color: var(--color-foreground--65);
			border-radius: 0.3rem;
			padding: 0.1rem 0.25rem;
			--chip-text-transform: none;
			--chip-background: transparent;
			display: inline-flex !important;
			min-width: 0;
			max-width: 100%;
			width: auto;
			overflow: hidden;
		}
		.reachability-range-chip:hover,
		.reachability-range-chip:focus {
			opacity: 1;
		}
		.reachability-range-chip--range {
			cursor: pointer;
		}
		.reachability-range-chip--local-branch {
			color: var(--vscode-gitlens-graphScrollMarkerLocalBranchesColor, #4ec9b0);
			font-weight: 600;
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
			white-space: nowrap;
			font-size: inherit;
		}
		.reachability-range-chip__label code-icon {
			vertical-align: middle;
			margin-right: 0.2rem;
		}

		.reachability-range-chip__ellipsis {
			opacity: 0.8;
			padding: 0 0.4rem;
		}

		.reachability-range-chip__count {
			padding-left: 0.4rem;
			font-weight: 600;
			font-size: var(--gl-font-micro);
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
			align-items: center;
			gap: 0.5rem;
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
		.mq-hide-sm,
		gl-autolink-chip::part(label) {
			/* Will be hidden at narrow widths */
		}
		@media (max-width: 300px) {
			.mq-hide-sm,
			gl-autolink-chip::part(label) {
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
			margin: 1rem auto 0;
			text-align: left;
			max-width: 30rem;
			transition: max-width 0.2s ease-out;
		}
		@media (min-width: 640px) {
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
			font-size: var(--gl-font-base);
			border: 0.1rem solid var(--vscode-input-border, transparent);
			background: var(--vscode-input-background);
			margin-top: 1rem;
			padding: 0.5rem;
			border-radius: 2px;
		}
		.ai-content.has-error {
			border-left-color: var(--color-alert-errorBorder);
			border-left-width: 0.3rem;
			padding-left: 0.8rem;
		}
		.ai-content:empty {
			display: none;
		}
		.ai-content__summary {
			display: block;
			margin: 0;
			overflow-y: auto;
			overflow-x: hidden;
			max-height: 20rem;
		}

		/* Popover content */
		.popover-content {
			background-color: var(--color-background--level-15);
			padding: 0.8rem 1.2rem;
		}

		/* Alert */
		.alert {
			box-sizing: border-box;
			display: flex;
			align-items: center;
			gap: 0.6rem;
			width: 100%;
			max-width: 100%;
			margin-block: 0;
			background-color: var(--color-alert-warningBackground);
			border-radius: 0.3rem;
			padding: 0.4rem 0.8rem;
			color: var(--color-alert-warningForeground, var(--vscode-input-foreground));
			border: 1px solid var(--color-alert-warningBorder);
		}
		.alert code-icon {
			flex: none;
			--code-icon-size: 13px;
		}
		.alert__content {
			flex: 1;
			min-width: 0;
			font-size: var(--gl-font-base);
			line-height: 1.4;
			margin: 0;
		}

		/* Inline popover / tooltip hint */
		.inline-popover {
			display: inline-block;
		}
		.tooltip-hint {
			white-space: nowrap;
			border-bottom: 1px dashed currentColor;
		}

		/* Child component layout — these live inside the shadow root */
		webview-pane-group {
			height: 100%;
			flex: 1;
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
	// Embedded split-panel handle (used by both gl-commit-details and gl-wip-details)
	css`
		:host([variant='embedded']) .split__handle {
			position: relative;
			z-index: 1;
			width: 100%;
			height: 100%;
			display: flex;
			align-items: center;
			justify-content: center;
			border-top: 1px solid color-mix(in srgb, var(--vscode-sideBarSectionHeader-border) 60%, transparent);
		}
		:host([variant='embedded']) .split__handle::after {
			content: '';
			position: relative;
			top: -0.2rem;
			width: 5rem;
			height: 0.5rem;
			border-radius: 0.25rem;
			background-color: color-mix(in srgb, var(--color-foreground) 55%, var(--color-background));
			transition: background-color 0.15s ease;
		}
		:host([variant='embedded']) .split__handle:hover::after,
		:host([variant='embedded']) .split[dragging] .split__handle::after {
			background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
		}

		:host([variant='embedded']) gl-badge {
			font-size: var(--gl-font-micro);
		}

		:host([variant='embedded']) gl-badge::part(base) {
			background-color: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			border: none;
			font-variant: normal;
			font-weight: 500;
			line-height: 1;
			min-width: 1.6rem;
			justify-content: center;
			padding: 0.2rem 0.4rem;
			border-radius: 0.4rem;
		}
	`,
];
