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

	/* Bottom placement (details panel on the bottom) — flip the divider border and padding so it
	   sits against the graph above it instead of the rows below. */
	:host([position='bottom']) {
		padding-block: 0.3rem 0;
		border-block-end: none;
		border-block-start: var(--gl-border-width) solid var(--vscode-panel-border, var(--color-foreground--25));
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

	.pill {
		display: inline-flex;
		flex: 0 0 auto;
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

	.pill:hover {
		background: color-mix(in srgb, var(--vscode-focusBorder) 12%, transparent);
		border-color: color-mix(in srgb, var(--vscode-focusBorder) 70%, transparent);
	}

	.pill--primary {
		background: color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
		border-color: var(--vscode-focusBorder);
	}

	.pill--selected {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	.pill__dot {
		width: 0.7rem;
		height: 0.7rem;
		background: var(--gl-agent-working-color);
		border-radius: 50%;
	}

	.pill__agent-icon {
		font-size: var(--gl-font-sm);
	}

	/* Unpushed indicator — shares the canonical ahead/unpublished color (theme.scss :root token), the
	   same one the scope pane uses for unpushed commits. */
	.pill__unpushed-icon {
		font-size: var(--gl-font-sm);
		color: var(--gl-tracking-ahead, #4ec9b0);
	}

	/* Pill icon + hover icon share the canonical agent palette (theme.scss :root tokens, always
	   present in webviews — referenced bare, matching tree-view / agent-tooltip). */
	.pill--agent-idle .pill__agent-icon,
	.pill-hover__agent--idle code-icon {
		color: var(--gl-agent-idle-color);
	}

	.pill--agent-working .pill__agent-icon,
	.pill-hover__agent--working code-icon {
		color: var(--gl-agent-working-color);
	}

	.pill--agent-needs-input .pill__agent-icon,
	.pill-hover__agent--needs-input code-icon {
		color: var(--gl-agent-waiting-color);
	}

	.pill-hover {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 22rem;
		font-size: 1.15rem;
		line-height: 1.4;
	}

	.pill-hover__branch {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-weight: 600;
	}

	.pill-hover__branch code-icon {
		opacity: 0.85;
	}

	.pill-hover__row {
		display: flex;
		gap: var(--gl-space-8);
		font-size: var(--gl-font-sm);
		opacity: 0.9;
	}

	.pill-hover__files {
		opacity: 0.65;
	}

	.pill-hover__time {
		opacity: 0.6;
	}

	.pill-hover__agent {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		font-size: 1.05rem;
		opacity: 0.85;
	}

	.pill-hover__unpushed {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		font-size: var(--gl-font-sm);
		opacity: 0.9;
	}

	.pill-hover__unpushed code-icon {
		color: var(--gl-tracking-ahead, #4ec9b0);
	}
`;
