import { css } from 'lit';

export const wipBarStyles = css`
	:host {
		display: block;
		flex: 0 0 auto;
		padding-block-end: 0.3rem;
		font-family: var(--font-family);
		background: var(--color-background);
		border-block-end: var(--gl-border-width) solid var(--vscode-panel-border, var(--color-foreground--25));
	}

	.bar {
		/* Flex so the single '.pills' child (flex: 0 0 auto) sizes to its content and overflows to scroll. */
		display: flex;
		overflow: auto hidden;
		scrollbar-width: none;
	}

	.bar::-webkit-scrollbar {
		display: none;
	}

	/* While a wheel-pan is animating, take the pills out of hit-testing so sliding them under a
	   stationary cursor doesn't fire per-frame hover work (see onWheel). Restored once it settles. */
	.bar.scrolling .pills {
		pointer-events: none;
	}

	.pills {
		display: flex;
		flex: 0 0 auto;
		gap: var(--gl-space-4);
		align-items: center;
		min-height: 2rem;
		padding: var(--gl-space-6) var(--gl-space-8);
	}

	/* The popover wraps each pill in an anchor box, so the pill is no longer the flex item — restore
	   its sizing there. (gl-popover's own [slot='anchor'] is width: fit-content.) */
	gl-popover {
		flex: 0 0 auto;
	}

	.pill {
		display: inline-flex;
		gap: 0.35rem;
		align-items: center;
		padding: 0.15rem 0.55rem;
		font-size: 1.05rem;
		line-height: 1.5;
		white-space: nowrap;
		cursor: pointer;
		background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
		border: var(--gl-border-width) solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		border-radius: var(--gl-radius-sm);
	}

	/* Give icons the same line box as the text so flex centering is exact — must inherit BOTH (a unitless
	   line-height alone recomputes against each icon's own font-size). Same recipe as wip-stats. */
	.pill code-icon {
		font-size: inherit;
		line-height: inherit;
	}

	.pill:hover {
		background: color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent);
		border-color: color-mix(in srgb, var(--vscode-focusBorder) 70%, transparent);
	}

	.pill--primary {
		background: color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
		border-color: var(--vscode-focusBorder);
	}

	/* Fully inset: the popover's anchor wrapper is overflow: hidden, so an outline drawn even 1px
	   outside the pill's border box would be clipped to a hairline on one side. */
	.pill--selected {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
	}

	.pill__dot {
		width: 0.7rem;
		height: 0.7rem;
		background: var(--gl-agent-working-color);
		border-radius: 50%;
	}

	/* Icon + count read as one unit, so they stay tight against each other while the pill's own gap
	   separates them from the branch name. */
	.pill__agent {
		display: inline-flex;
		gap: 0.2rem;
		align-items: center;
	}

	.pill__agent-count {
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}

	/* Unpushed indicator — shares the canonical ahead/unpublished color (theme.scss :root token), the
	   same one the scope pane uses for unpushed commits. */
	.pill__unpushed-icon {
		color: var(--gl-tracking-ahead, #4ec9b0);
	}

	/* Pill icon shares the canonical agent palette (theme.scss :root tokens, always present in webviews —
	   referenced bare, matching tree-view / agent-tooltip). */
	.pill--agent-idle .pill__agent {
		color: var(--gl-agent-idle-color);
	}

	.pill--agent-working .pill__agent {
		color: var(--gl-agent-working-color);
	}

	.pill--agent-needs-input .pill__agent {
		color: var(--gl-agent-waiting-color);
	}
`;
