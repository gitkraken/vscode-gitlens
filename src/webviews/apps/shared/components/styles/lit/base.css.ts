import { css, unsafeCSS } from 'lit';
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
		background: var(--vscode-textCodeBlock-background);
		border-radius: 3px;
		padding: 0px 4px 2px 4px;
		font-family: var(--vscode-editor-font-family);
	}
`;

/**
 * Always-visible thin scrollbar scoped to specific element(s). Pass one or more selectors
 * (use `:host` for the component itself) — they're joined and the thumb/width rules apply to each.
 * Matches the visual contract of `scrollableBase` but with scrollbars always visible.
 */
export function scrollbarThinFor(...selectors: string[]) {
	const sel = unsafeCSS(selectors.join(', '));
	return css`
		${sel} {
			scrollbar-width: thin;
			scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
		}
		${sel}::-webkit-scrollbar {
			width: 10px;
		}
		${sel}::-webkit-scrollbar-thumb {
			background-color: var(--vscode-scrollbarSlider-background);
		}
		${sel}::-webkit-scrollbar-thumb:hover {
			background-color: var(--vscode-scrollbarSlider-hoverBackground);
		}
		${sel}::-webkit-scrollbar-thumb:active {
			background-color: var(--vscode-scrollbarSlider-activeBackground);
		}
	`;
}

/**
 * Fade + slide-up entrance for a sub-panel. Consumer markup: `<div class="sub-panel-enter">…`.
 * Respects `prefers-reduced-motion`.
 */
export const subPanelEnterStyles = css`
	@keyframes sub-panel-enter {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.sub-panel-enter {
		animation: sub-panel-enter 0.2s ease-out;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
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
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
`;
