import { css } from 'lit';

/**
 * Shared styles for mode toggle chips (review, compose, compare).
 * Apply `mode-toggle--active` class to the active mode's action chip.
 */
export const modeToggleStyles = css`
	.mode-toggle--active {
		background: var(--vscode-focusBorder) !important;
		color: #fff !important;
		border-radius: 0.4rem;
	}

	.mode-toggle--active:hover {
		background: color-mix(in srgb, var(--vscode-focusBorder) 85%, #fff) !important;
	}
`;

/**
 * Shared styles for sticky headers that highlight when a mode is active.
 * Apply `mode-header` class to the header element, and add `mode-header--active`
 * when a mode (review/compose/compare) is active.
 *
 * Customizable via CSS custom properties:
 * - `--mode-header-tint`: tint percentage (default 35%)
 * - `--mode-header-bg`: base background color for the tint mix
 */
export const modeHeaderStyles = css`
	.mode-header {
		background-color: var(--mode-header-bg);
		border-top: 2px solid transparent;
		/* Exit transition (class removed): fast fade back to base */
		transition:
			background-color 0.1s ease-out,
			border-color 0.1s ease-out;
	}

	.mode-header--active {
		border-top-color: var(--vscode-focusBorder);
		background-color: color-mix(
			in srgb,
			var(--vscode-focusBorder) var(--mode-header-tint, 35%),
			var(--mode-header-bg, var(--titlebar-bg, var(--vscode-sideBar-background, var(--color-background))))
		);
		/* Enter transition (class added): slightly slower fade to tinted */
		transition:
			background-color 0.15s ease-in,
			border-color 0.15s ease-in;
	}
`;
