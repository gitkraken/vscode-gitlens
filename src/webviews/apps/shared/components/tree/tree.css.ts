import { css } from 'lit';
import { elementBase } from '../styles/lit/base.css.js';

export const treeStyles = [
	elementBase,
	css`
		:host {
			display: block;
			height: 100%;
		}
	`,
];

export const treeItemStyles = [
	elementBase,
	css`
		:host {
			--tree-connector-spacing: 0.6rem;
			--tree-connector-size: var(--gitlens-tree-indent, 1.6rem);

			box-sizing: border-box;
			display: flex;
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			height: 2.2rem;
			padding: 0.1rem 0.5rem 0.1rem var(--gitlens-gutter-width);

			/* Reduced containment to allow tooltips to escape */
			contain: layout;
			font-size: var(--vscode-font-size);
			line-height: 2.2rem;
			color: var(--gitlens-tree-foreground, var(--vscode-foreground));
			cursor: pointer;
		}

		:host([aria-hidden='true']) {
			display: none;
		}

		/* Rich mode: host a multi-line / card component (e.g. gl-commit-row) in the default slot.
	   Relaxes the single-line tree-row constraints so the consumer's content drives row height. */
		:host([rich]) {
			height: auto;
			min-height: var(--gl-tree-item-min-height, 2.2rem);
			padding-top: var(--gl-tree-item-padding-y, 0.4rem);
			padding-bottom: var(--gl-tree-item-padding-y, 0.4rem);
			line-height: normal;
		}

		:host([rich]) .item {
			align-items: stretch;
		}

		:host([rich]) .text {
			text-overflow: clip;
			line-height: normal;
			white-space: normal;
		}

		:host([rich]) .main,
		:host([rich]) .description {
			display: block;
		}

		:host(:hover) {
			/* Raise above sibling items so action tooltips aren't painted behind the next row */
			z-index: 1;
			color: var(--vscode-list-hoverForeground);
			background-color: var(--vscode-list-hoverBackground);
		}

		/* Disabled state — propagated from disable-check so AI-excluded files (or any other
	   row that shouldn't be acted on) read as visually inactive AND inert (clicking the
	   row will not open the file or trigger any action — same UX as a disabled menu item).
	   The checkbox visual is already dimmed via .checkbox:has(:disabled) and the underlying
	   <input> is :disabled, so it cannot be activated regardless. */
		:host([disable-check]) .item,
		:host([disable-check]) slot[name='decorations-before'],
		:host([disable-check]) slot[name='decorations-after'],
		:host([disable-check]) .actions {
			color: var(--vscode-disabledForeground, inherit);
			opacity: 0.7;
		}

		:host([disable-check]) .item {
			pointer-events: none;
			cursor: default;
		}

		:host([disable-check]) .actions {
			pointer-events: none;
		}

		:host([disable-check]:hover) {
			background-color: transparent;
		}

		/* Selection AND the focused-cursor highlight get identical treatment: both brighten from the
	   inactive to the active selection colors via the --gl-tree-focus-within var (0/1), set by
	   gl-tree-view's :host(:focus-within) and inherited across the shadow boundary. It must be a
	   CSS-only signal because DOM focus routinely lands *inside* a row — clicking focuses the row's
	   inner button and Tab focuses its checkbox — so the container's own focus/blur can't be trusted,
	   but :focus-within still holds while focus is anywhere in the tree. Folders are never selection
	   members, so a folder cursor only hits the second selector; giving it the same colors means a
	   focused folder reads like a selected file — active while the tree (or a checkbox in it) has
	   focus, and keeping the inactive highlight when the tree loses focus. */
		:host([aria-selected='true']),
		:host([focused]:not([aria-selected='true'])) {
			color: color-mix(
				in srgb,
				var(--vscode-list-activeSelectionForeground) calc(var(--gl-tree-focus-within, 0) * 100%),
				var(--vscode-list-inactiveSelectionForeground)
			);
			background-color: color-mix(
				in srgb,
				var(--vscode-list-activeSelectionBackground) calc(var(--gl-tree-focus-within, 0) * 100%),
				var(--vscode-list-inactiveSelectionBackground)
			);
		}

		/* Focus outline on the cursor row; fades out with the var when focus leaves the tree. */
		:host([focused]) {
			z-index: 1;
			outline: var(--gl-border-width) solid
				color-mix(
					in srgb,
					var(--vscode-list-focusOutline) calc(var(--gl-tree-focus-within, 0) * 100%),
					transparent
				);
			outline-offset: -0.1rem;
		}

		/* A row that physically contains DOM focus (its button or checkbox) is unambiguously in the
	   focused tree — show a solid outline regardless of the var. */
		:host(:focus-within) {
			z-index: 1;
			outline: var(--gl-border-width) solid var(--vscode-list-focusOutline);
			outline-offset: -0.1rem;
		}

		.item {
			display: flex;
			flex: 1;
			flex-direction: row;
			gap: var(--gl-space-6);
			align-items: center;
			justify-content: flex-start;
			min-width: 0;
			padding: 0;
			font-family: inherit;
			font-size: inherit;
			color: inherit;
			text-decoration: none;
			appearance: none;
			cursor: pointer;
			outline: none;
			background: none;
			border: none;
		}

		.icon {
			display: inline-flex;
			flex: none;
			align-items: center;
			justify-content: center;
			width: var(--gl-icon-size, 1.6rem);
			height: 2.2rem;
			pointer-events: none;
		}

		slot[name='icon']::slotted(*) {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: var(--gl-icon-size, 1.6rem);
			height: 1.6rem;
			vertical-align: middle;
		}

		.node {
			display: inline-block;
			flex: none;
			width: var(--tree-connector-size);
			height: 2.2rem;
			line-height: 2.2rem;
			vertical-align: text-bottom;
			text-align: center;
			pointer-events: none;
		}

		.node:last-of-type {
			margin-right: 0.3rem;
		}

		.node--connector {
			position: relative;
		}

		.node--connector::before {
			position: absolute;
			top: 50%;
			left: 0.8rem;
			width: 0.1rem;
			height: 2.2rem;
			content: '';
			border-left: var(--gl-border-width) solid transparent;
			opacity: 0.4;
			transform: translate(-1px, -50%);
			transition: border-color var(--gl-duration-x-fast) linear;
		}

		@media (prefers-reduced-motion: reduce) {
			.node--connector::before {
				transition: none;
			}
		}

		:host-context([guides='always']) .node--connector::before,
		:host-context([guides='onHover']:focus-within) .node--connector::before,
		:host-context([guides='onHover'][focused]) .node--connector::before,
		:host-context([guides='onHover']:hover) .node--connector::before {
			border-color: var(--vscode-tree-indentGuidesStroke);
		}

		.branch {
			display: inline-block;
			height: 2.2rem;
			margin-right: var(--gl-space-6);
			line-height: 2.2rem;
			vertical-align: text-bottom;
		}

		.text {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			line-height: 1.8rem;
			text-align: left;
			white-space: nowrap;
		}

		.main {
			display: inline;
		}

		.description {
			display: inline;
			margin-left: 0.3rem;
			font-size: 0.9em;
			pointer-events: none;
			opacity: 0.7;
		}

		.actions {
			flex: none;
			margin-left: var(--gl-space-4);
			color: var(--vscode-icon-foreground);
			user-select: none;
		}

		:host(:focus-within) .actions,
		:host([focused]) .actions {
			color: var(--vscode-list-activeSelectionIconForeground);
		}

		:host(:not(:hover, :focus-within, [focused])) .actions {
			display: none;
		}

		/* Rows with no actions still render an empty action-nav; its margin would otherwise appear on
		   hover and shift the decorations. Keep it out of layout entirely when nothing is slotted. */
		:host(:not(:has([slot='actions']))) .actions {
			display: none;
		}

		/* Tooltip wrapper around the checkbox has display: block + line-height from the host,
	   which adds inline leading and pushes the checkbox 1px above the row. Center-fit it. */
		gl-tooltip:has(> .checkbox) {
			display: inline-flex;
			align-items: center;
			line-height: 0;
		}

		.checkbox {
			position: relative;
			display: inline-flex;
			width: 1.6rem;
			aspect-ratio: 1 / 1;
			margin-right: var(--gl-space-8);
			color: var(--vscode-checkbox-foreground);
			text-align: center;
			background: var(--vscode-checkbox-background);
			border: var(--gl-border-width) solid var(--vscode-checkbox-border);
			border-radius: var(--gl-radius-sm);
		}

		.checkbox:has(:checked),
		.checkbox:has(:indeterminate) {
			color: var(--vscode-checkbox-foreground);
			background-color: var(--vscode-checkbox-selectBackground);
			border-color: var(--vscode-checkbox-selectBorder);
		}

		.checkbox:has(:disabled) {
			opacity: 0.4;
		}

		/* Theme-aware keyboard focus ring — the appearance:none input would otherwise show the browser
	   default outline. Drawn on the wrapper so it frames the whole 1.6rem box; the input's own outline
	   stays off (see .checkbox__input). :focus-visible keeps it keyboard-only, matching VS Code. */
		.checkbox:has(.checkbox__input:focus-visible) {
			outline: var(--gl-border-width) solid var(--vscode-focusBorder);
			outline-offset: 0.1rem;
		}

		.checkbox__input {
			position: absolute;
			top: 0;
			left: 0;
			width: 1.4rem;
			aspect-ratio: 1 / 1;
			margin: 0;
			appearance: none;
			cursor: pointer;
			outline: none;
			border-radius: var(--gl-radius-sm);
		}

		.checkbox__input:disabled {
			cursor: default;
		}

		.checkbox__check,
		.checkbox__dash {
			position: absolute;
			top: 0;
			left: 0;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 1.6rem;
			aspect-ratio: 1 / 1;
			color: var(--vscode-checkbox-foreground);
			pointer-events: none;
			opacity: 0;
			transition: opacity var(--gl-duration-x-fast) linear;
		}

		.checkbox__input:checked + .checkbox__check {
			opacity: 1;
		}

		.checkbox__input:indeterminate ~ .checkbox__dash {
			opacity: 1;
		}

		slot[name='decorations-before'],
		slot[name='decorations-after'] {
			display: inline-flex;
			flex: none;
			gap: var(--gl-space-4);
			align-items: center;
			margin-left: var(--gl-space-4);
			white-space: nowrap;
			--gl-pill-border: color-mix(in srgb, transparent 80%, var(--color-foreground));
		}

		::slotted([slot='decorations-before'].decoration-text) {
			font-size: var(--gl-decoration-before-font-size, inherit);
			opacity: var(--gl-decoration-before-opacity, 1);
		}

		::slotted([slot='decorations-after'].decoration-text) {
			font-size: var(--gl-decoration-after-font-size, inherit);
			opacity: var(--gl-decoration-after-opacity, 1);
		}

		::slotted([slot^='decorations-'].decoration-text--added),
		::slotted([slot^='decorations-'].conflict-count--added) {
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}

		::slotted([slot^='decorations-'].conflict-count--added) {
			border-color: color-mix(in srgb, transparent 60%, var(--vscode-gitDecoration-addedResourceForeground));
		}

		::slotted([slot^='decorations-'].decoration-text--deleted),
		::slotted([slot^='decorations-'].conflict-count--deleted) {
			color: var(--vscode-gitDecoration-deletedResourceForeground);
		}

		::slotted([slot^='decorations-'].conflict-count--deleted) {
			border-color: color-mix(in srgb, transparent 60%, var(--vscode-gitDecoration-deletedResourceForeground));
		}

		::slotted([slot^='decorations-'].decoration-text--modified),
		::slotted([slot^='decorations-'].conflict-count--modified) {
			color: var(--vscode-gitDecoration-modifiedResourceForeground);
		}

		::slotted([slot^='decorations-'].conflict-count--modified) {
			border-color: color-mix(in srgb, transparent 60%, var(--vscode-gitDecoration-modifiedResourceForeground));
		}

		::slotted([slot^='decorations-'].decoration-text--untracked) {
			color: var(--vscode-gitDecoration-untrackedResourceForeground);
		}

		::slotted([slot^='decorations-'].decoration-text--renamed) {
			color: var(--vscode-gitDecoration-renamedResourceForeground);
		}

		::slotted([slot^='decorations-'].decoration-text--conflict),
		::slotted([slot^='decorations-'].conflict-count--conflict) {
			color: var(--vscode-gitDecoration-conflictingResourceForeground);
		}

		::slotted([slot^='decorations-'].conflict-count--conflict) {
			border-color: color-mix(
				in srgb,
				transparent 60%,
				var(--vscode-gitDecoration-conflictingResourceForeground)
			);
		}

		::slotted([slot^='decorations-'].decoration-text--muted) {
			color: var(--vscode-descriptionForeground);
		}

		/* High Contrast Mode Support */
		@media (forced-colors: active) {
			:host {
				forced-color-adjust: none;
			}

			:host([focused]) {
				outline: 2px solid CanvasText;
				outline-offset: -2px;
			}

			:host([aria-selected='true']) {
				color: HighlightText;
				background-color: Highlight;
			}

			:host([aria-selected='true'][focused]) {
				outline: 2px solid CanvasText;
				outline-offset: -2px;
			}

			.checkbox {
				border: var(--gl-border-width) solid CanvasText;
			}

			.checkbox:has(:checked),
			.checkbox:has(:indeterminate) {
				background-color: Highlight;
				border-color: CanvasText;
			}

			.node--connector::before {
				border-color: CanvasText;
				opacity: 1;
			}

			slot[name='decorations-after'] span {
				color: CanvasText !important;
			}
		}
	`,
];
