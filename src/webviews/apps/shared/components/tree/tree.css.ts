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
			padding-left: var(--gitlens-gutter-width);
			padding-right: 0.5rem;
			padding-top: 0.1rem;
			padding-bottom: 0.1rem;
			line-height: 2.2rem;
			height: 2.2rem;

			display: flex;
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			font-size: var(--vscode-font-size);
			color: var(--gitlens-tree-foreground, var(--vscode-foreground));

			cursor: pointer;
			/* Reduced containment to allow tooltips to escape */
			contain: layout;
		}

		:host([aria-hidden='true']) {
			display: none;
		}

		/* Rich mode: host a multi-line / card component (e.g. gl-commit-row) in the default slot.
		   Relaxes the single-line tree-row constraints so the consumer's content drives row height. */
		:host([rich]) {
			height: auto;
			min-height: var(--gl-tree-item-min-height, 2.2rem);
			line-height: normal;
			padding-top: var(--gl-tree-item-padding-y, 0.4rem);
			padding-bottom: var(--gl-tree-item-padding-y, 0.4rem);
		}

		:host([rich]) .item {
			align-items: stretch;
		}

		:host([rich]) .text {
			line-height: normal;
			white-space: normal;
			text-overflow: clip;
		}

		:host([rich]) .main,
		:host([rich]) .description {
			display: block;
		}

		:host(:hover) {
			color: var(--vscode-list-hoverForeground);
			background-color: var(--vscode-list-hoverBackground);
			/* Raise above sibling items so action tooltips aren't painted behind the next row */
			z-index: 1;
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
			opacity: 0.7;
			color: var(--vscode-disabledForeground, inherit);
		}

		:host([disable-check]) .item {
			cursor: default;
			pointer-events: none;
		}

		:host([disable-check]) .actions {
			pointer-events: none;
		}

		:host([disable-check]:hover) {
			background-color: transparent;
		}

		:host([aria-selected='true']) {
			color: var(--vscode-list-inactiveSelectionForeground);
			background-color: var(--vscode-list-inactiveSelectionBackground);
		}

		/* Focused state - when the item is the active descendant in the tree */
		:host([focused]) {
			outline: 1px solid var(--vscode-list-focusOutline);
			outline-offset: -0.1rem;
			z-index: 1;
		}

		:host([aria-selected='true'][focused]) {
			color: var(--vscode-list-activeSelectionForeground);
			background-color: var(--vscode-list-activeSelectionBackground);
		}

		/* Inactive focus state - when the item would be focused but container doesn't have focus */
		/* In VS Code, inactive focus shows the selection background without the outline */
		:host([focused-inactive]) {
			color: var(--vscode-list-inactiveSelectionForeground);
			background-color: var(--vscode-list-inactiveSelectionBackground);
		}

		/* TODO: these should be :has(.input:focus) instead of :focus-within */
		:host(:focus-within) {
			outline: 1px solid var(--vscode-list-focusOutline);
			outline-offset: -0.1rem;
			z-index: 1;
		}

		:host([aria-selected='true']:focus-within) {
			color: var(--vscode-list-activeSelectionForeground);
			background-color: var(--vscode-list-activeSelectionBackground);
		}

		.item {
			appearance: none;
			display: flex;
			flex-direction: row;
			justify-content: flex-start;
			align-items: center;
			gap: 0.6rem;
			flex: 1;
			min-width: 0;
			padding: 0;
			font-family: inherit;
			font-size: inherit;
			text-decoration: none;
			color: inherit;
			background: none;
			border: none;
			outline: none;
			cursor: pointer;
		}
		.icon {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: var(--gl-icon-size, 1.6rem);
			height: 2.2rem;
			pointer-events: none;
			flex: none;
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
			width: var(--tree-connector-size);
			text-align: center;
			flex: none;
			height: 2.2rem;
			line-height: 2.2rem;
			pointer-events: none;
			vertical-align: text-bottom;
		}

		.node:last-of-type {
			margin-right: 0.3rem;
		}

		.node--connector {
			position: relative;
		}

		.node--connector::before {
			content: '';
			position: absolute;
			height: 2.2rem;
			border-left: 1px solid transparent;
			top: 50%;
			transform: translate(-1px, -50%);
			left: 0.8rem;
			width: 0.1rem;
			transition: border-color 0.1s linear;
			opacity: 0.4;
		}

		@media (prefers-reduced-motion: reduce) {
			.node--connector::before {
				transition: none;
			}
		}

		:host-context([guides='always']) .node--connector::before,
		:host-context([guides='onHover']:focus-within) .node--connector::before,
		:host-context([guides='onHover'][focused]) .node--connector::before,
		:host-context([guides='onHover'][focused-inactive]) .node--connector::before,
		:host-context([guides='onHover']:hover) .node--connector::before {
			border-color: var(--vscode-tree-indentGuidesStroke);
		}

		.branch {
			display: inline-block;
			margin-right: 0.6rem;
			height: 2.2rem;
			line-height: 2.2rem;
			vertical-align: text-bottom;
		}

		.text {
			line-height: 1.8rem;
			overflow: hidden;
			white-space: nowrap;
			text-align: left;
			text-overflow: ellipsis;
			flex: 1;
		}

		.main {
			display: inline;
		}

		.description {
			display: inline;
			opacity: 0.7;
			font-size: 0.9em;
			margin-left: 0.3rem;
			pointer-events: none;
		}

		.actions {
			flex: none;
			user-select: none;
			color: var(--vscode-icon-foreground);
			margin-left: 0.4rem;
		}

		:host(:focus-within) .actions,
		:host([focused]) .actions {
			color: var(--vscode-list-activeSelectionIconForeground);
		}

		:host([focused-inactive]) .actions {
			color: var(--vscode-list-inactiveSelectionIconForeground, var(--vscode-icon-foreground));
		}

		:host(:not(:hover):not(:focus-within):not([focused]):not([focused-inactive])) .actions {
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
			text-align: center;
			color: var(--vscode-checkbox-foreground);
			background: var(--vscode-checkbox-background);
			border: 1px solid var(--vscode-checkbox-border);
			border-radius: 0.3rem;
			margin-right: 0.6rem;
		}

		.checkbox:has(:checked),
		.checkbox:has(:indeterminate) {
			color: var(--vscode-checkbox-foreground);
			border-color: var(--vscode-checkbox-selectBorder);
			background-color: var(--vscode-checkbox-selectBackground);
		}

		.checkbox:has(:disabled) {
			opacity: 0.4;
		}

		.checkbox__input {
			position: absolute;
			top: 0;
			left: 0;
			appearance: none;
			width: 1.4rem;
			aspect-ratio: 1 / 1;
			margin: 0;
			cursor: pointer;
			border-radius: 0.3rem;
		}

		.checkbox__input:disabled {
			cursor: default;
		}

		.checkbox__check,
		.checkbox__dash {
			position: absolute;
			top: 0;
			left: 0;
			width: 1.6rem;
			aspect-ratio: 1 / 1;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			opacity: 0;
			transition: opacity 0.1s linear;
			color: var(--vscode-checkbox-foreground);
			pointer-events: none;
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
			align-items: center;
			gap: 0.4rem;
			flex: none;
			white-space: nowrap;
			margin-left: 0.4rem;
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

		/* Agent phase decoration text — own palette (NOT SCM tokens, which semantically belong to
		   file change states). Matches the tree-icon-agent--* colors so a leaf's icon and its
		   phase text decoration agree. */
		::slotted([slot^='decorations-'].decoration-text--agent-working) {
			color: var(--gl-agent-working-color);
		}
		::slotted([slot^='decorations-'].decoration-text--agent-waiting) {
			color: var(--gl-agent-waiting-color);
		}
		::slotted([slot^='decorations-'].decoration-text--agent-idle) {
			color: var(--gl-agent-idle-color);
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
				background-color: Highlight;
				color: HighlightText;
			}

			:host([aria-selected='true'][focused]) {
				outline: 2px solid CanvasText;
				outline-offset: -2px;
			}

			.checkbox {
				border: 1px solid CanvasText;
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
