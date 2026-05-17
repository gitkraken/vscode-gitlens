import { css } from 'lit';

/**
 * Shared styles for mode toggle chips (compose / review). Chips only render in the IDLE
 * state — the active-mode chip cluster is hidden once a mode is engaged (see
 * `gl-details-header.renderModeToggles`). When the chip is in `--has-status`, it picks up
 * a per-mode accent so the user can see at a glance "I have a pending compose / review
 * elsewhere" without entering the mode first.
 *
 * The per-mode accent is keyed off the `.mode-toggle--compose` / `.mode-toggle--review`
 * class on the chip itself (not the cascading `--mode-accent` token, which is only set
 * when the panel host has a `data-mode`).
 */
export const modeToggleStyles = css`
	/* Single accent for both compose and review chips, mirroring the unified mode-header
	   accent. Mode identity is carried by the chip icon (wand vs checklist) and overlay
	   status icon (loading / pass / etc.) — color is redundant when icons already
	   differentiate. Error and orphaned states still override for semantic colorization. */
	.mode-toggle--compose,
	.mode-toggle--review {
		--mode-toggle-accent: var(--color-highlight, var(--vscode-focusBorder));
	}

	.mode-toggle--has-status {
		background: var(--mode-toggle-accent) !important;
		border-radius: 0.4rem;
		/* --vscode-button-foreground is the contrast-paired token for --vscode-button-background
		   (which --color-highlight wraps), so it stays readable across light/dark themes — unlike
		   hardcoded white, which falls below WCAG contrast on pale-accent light themes. */
		color: var(--vscode-button-foreground, #fff) !important;
	}
	.mode-toggle--has-status:hover {
		/* Mix toward currentColor (the chip's text color above) rather than hardcoded white. In
		   dark themes the text is white → mix lightens the accent; in light themes the text is
		   dark → mix darkens the accent. Either way the hover state stays visibly distinct from
		   the resting state, instead of fading into the page on light themes. */
		background: color-mix(in srgb, var(--mode-toggle-accent) 85%, currentColor) !important;
	}
	.mode-toggle--has-status[data-state='error'] {
		--mode-toggle-accent: var(--vscode-errorForeground, var(--vscode-focusBorder));
	}
	.mode-toggle--has-status[data-state='orphaned'] {
		--mode-toggle-accent: var(--color-foreground--50, var(--vscode-descriptionForeground));
	}
`;

/**
 * Shared styles for sticky headers that highlight when a mode is active.
 * Apply `mode-header` class to the header element, and add `mode-header--active`
 * when a mode (review/compose) is active.
 *
 * The accent tint on its own carries the "you're in mode X" signal — no top
 * border or left rail; those read as too much chrome alongside the title swap
 * and the colored chip cluster.
 *
 * Customizable via CSS custom properties:
 * - `--mode-header-tint`: tint percentage (default 50%; same across all panel contexts)
 * - `--mode-header-bg`: base background color for the tint mix
 * - `--mode-accent`: the tint color (set per-mode via `data-mode` on the panel host)
 */
export const modeHeaderStyles = css`
	.mode-header {
		background-color: var(--mode-header-bg);
		/* Exit transition (class removed): fast fade back to base */
		transition: background-color 0.1s ease-out;
	}

	.mode-header--active {
		background-color: color-mix(
			in srgb,
			var(--mode-accent, var(--vscode-focusBorder)) var(--mode-header-tint, 50%),
			var(--mode-header-bg, var(--titlebar-bg, var(--vscode-sideBar-background, var(--color-background))))
		);
		/* Enter transition (class added): slightly slower fade to tinted */
		transition: background-color 0.15s ease-in;
	}
`;

/**
 * Per-mode color tokens are owned by the global stylesheet (see `graph.scss`'s
 * `gl-graph-details-panel[data-mode='X']` rules) because the panel host renders in light
 * DOM, where `:host` selectors don't apply. CSS variables cascade through shadow roots
 * into descendants, so setting `--mode-accent` on the host is enough for the chip / header
 * tokens above to pick the right color. Falls back to `--vscode-focusBorder` everywhere a
 * `--mode-accent` reference is read so out-of-mode usage still renders.
 */
