import { css } from 'lit';

export const wipBarStyles = css`
	:host {
		display: block;
		flex: 0 0 auto;
		padding-block-end: 0.3rem;
		font-family: var(--font-family);
		background: var(--color-background);
		border-block-end: 1px solid var(--vscode-panel-border, var(--color-foreground--25));
	}

	.bar {
		display: flex;
		gap: 0.4rem;
		align-items: center;

		/* No start inset so the sticky label can cover the edge as pills scroll under it; the label
		   carries the leading inset itself. */
		padding-inline-end: 0.8rem;
		overflow: auto hidden;
		scrollbar-width: none;
	}

	.bar::-webkit-scrollbar {
		display: none;
	}

	.label {
		position: sticky;
		inset-inline-start: 0;
		z-index: 1;
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;

		/* Stretch over the bar's full height so the opaque background fully masks pills passing under. */
		align-self: stretch;
		padding-inline: 0.8rem 0.4rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--vscode-descriptionForeground, var(--color-foreground--65));
		text-transform: uppercase;
		letter-spacing: 0.05em;
		user-select: none;
		background: var(--color-background);
	}

	.label::after {
		position: absolute;
		inset-inline-start: 100%;
		width: 0.4rem;
		height: 100%;
		content: '';
		background: linear-gradient(to right, var(--color-background), transparent);
	}

	.pills {
		display: flex;
		flex: 0 0 auto;
		gap: 0.4rem;
		align-items: center;
		min-height: 2rem;
		padding-block: 0.6rem;
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
		border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
		border-radius: 3px;
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
		background: var(--vscode-charts-purple, #b180d7);
		border-radius: 50%;
	}

	.pill__agent-icon {
		font-size: 1.1rem;
	}

	/* Unpushed indicator — shares the canonical ahead/unpublished color (theme.scss :root token), the
	   same one the scope pane uses for unpushed commits. */
	.pill__unpushed-icon {
		font-size: 1.1rem;
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
		gap: 0.8rem;
		font-size: 1.1rem;
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
		font-size: 1.1rem;
		opacity: 0.9;
	}

	.pill-hover__unpushed code-icon {
		color: var(--gl-tracking-ahead, #4ec9b0);
	}
`;
