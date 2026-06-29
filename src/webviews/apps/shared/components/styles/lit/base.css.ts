import { css } from 'lit';
import { focusOutline } from './a11y.css.js';

export const elementBase = css`
	:host {
		box-sizing: border-box;
	}

	:host *,
	:host *::before,
	:host *::after {
		box-sizing: inherit;
	}

	[hidden] {
		display: none !important;
	}
`;

export const boxSizingBase = css`
	* {
		box-sizing: border-box;
	}
`;

export const linkBase = css`
	a {
		color: var(--vscode-textLink-foreground);
		text-decoration: none;
	}

	a:focus {
		${focusOutline}
	}

	a:hover {
		text-decoration: underline;
	}
`;

export const scrollableBase = css`
	::-webkit-scrollbar {
		width: 10px;
		height: 10px;
	}

	::-webkit-scrollbar-corner {
		background-color: transparent;
	}

	::-webkit-scrollbar-thumb {
		background-color: transparent;
		border-color: inherit;
		border-right-style: inset;
		border-right-width: calc(100vw + 100vh);
		border-radius: unset !important;
	}

	::-webkit-scrollbar-thumb:hover {
		border-color: var(--vscode-scrollbarSlider-hoverBackground);
	}

	::-webkit-scrollbar-thumb:active {
		border-color: var(--vscode-scrollbarSlider-activeBackground);
	}

	.scrollable {
		border-color: transparent;
		transition: border-color 1s linear;
	}

	:host(:hover) .scrollable,
	:host(:focus-within) .scrollable {
		border-color: var(--vscode-scrollbarSlider-background);
		transition: none;
	}

	:host-context(.preload) .scrollable {
		transition: none;
	}
`;

export const inlineCode = css`
	.inline-code {
		padding: 0 var(--gl-space-4) var(--gl-space-2);
		font-family: var(--vscode-editor-font-family);
		background: var(--vscode-textCodeBlock-background);
		border-radius: var(--gl-radius-sm);
	}
`;

/**
 * Fade + slide-up entrance for a sub-panel. Consumer markup: `<div class="sub-panel-enter">…`, or
 * applied to a scrollable `:host` (compose/review mode panels). Respects `prefers-reduced-motion`.
 *
 * `overflow: hidden` is pinned across both keyframes so a scrollable consumer can't flash a
 * scrollbar while the transform settles — the animation's own lifetime gates overflow (a running
 * animation overrides the resting `:host { overflow-y: auto }` in the cascade, then reverts when it
 * ends). This replaces the prior JS `animationend` latch + timer-based clamps with pure CSS.
 */
export const subPanelEnterStyles = css`
	@keyframes sub-panel-enter {
		from {
			opacity: 0;
			transform: translateY(4px);
			overflow: hidden;
		}

		to {
			opacity: 1;
			transform: translateY(0);
			overflow: hidden;
		}
	}

	.sub-panel-enter {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
		animation: sub-panel-enter var(--gl-duration-medium) var(--gl-ease-out);
	}

	@media (prefers-reduced-motion: reduce) {
		.sub-panel-enter {
			animation: none;
		}
	}
`;

/** Flex column panel that fills available space. */
export const panelBase = css`
	:host {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
`;

/**
 * Shared metadata-bar visual contract — the tinted strip beneath a panel title used by
 * single-commit details, multi-commit compare, the WIP secondary header, and review/compose
 * results. Consumers read `var(--gl-metadata-bar-bg)` etc.; defining the variables on `:host`
 * keeps any panel that adopts these styles in sync without re-declaring the literal values.
 */
export const metadataBarVarsBase = css`
	:host {
		--gl-metadata-bar-bg: color-mix(in srgb, var(--color-background) 95%, var(--color-foreground) 5%);
		--gl-metadata-bar-border: var(--vscode-sideBarSectionHeader-border, var(--color-foreground--25));
		--gl-metadata-bar-min-height: 2.94rem;
	}
`;
