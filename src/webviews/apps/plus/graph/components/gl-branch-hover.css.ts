import { css } from 'lit';

export const branchHoverStyles = css`
	:host {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		min-width: 24rem;
		max-width: 36rem;
	}

	gl-avatar-list {
		--gl-avatar-size: 2rem;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
	}

	.section--inline {
		flex-flow: row wrap;
		gap: var(--gl-space-6);
		align-items: center;
		justify-content: space-between;
	}

	.section + .section {
		padding-top: var(--gl-space-6);
		border-top: var(--gl-border-width) solid var(--vscode-widget-border, transparent);
	}

	.row {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		max-width: 100%;
	}

	.name {
		flex-grow: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name--bold {
		font-weight: bold;
	}

	.name a {
		color: inherit;
		text-decoration: none;
	}

	.name a:hover {
		text-decoration: underline;
	}

	.identifier {
		color: var(--vscode-descriptionForeground);
	}

	.icon {
		flex: none;
		color: var(--vscode-descriptionForeground);
	}

	.text {
		margin: 0;
		line-height: 1.4;
	}

	.text--secondary {
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
	}

	.muted {
		margin-inline-start: var(--gl-space-4);
		color: var(--vscode-descriptionForeground);
	}

	.launchpad {
		display: inline-flex;
		gap: var(--gl-space-4);
		align-items: center;
		font-size: 0.9em;
	}

	.launchpad--mergeable {
		color: var(--vscode-gitlens-launchpadIndicatorMergeableColor);
	}

	.launchpad--blocked {
		color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
	}

	.launchpad--attention {
		color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
	}

	.avatars {
		flex: none;
		margin-inline-start: auto;
	}

	/* Matches the overview card's meta row (.branch-item__meta), which is also 0.9em. The pills' own
	   internals are a fixed 1rem, but their SLOTTED content (tracking arrows/counts, wip icons) inherits
	   from here — so without this the hover's pills render visibly chunkier than the identical pills
	   inline on the card. (No --gl-pill-padding override either, for the same reason.) */
	.status-group {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-6);
		align-items: center;
		font-size: 0.9em;
	}

	/* Scoped to this hover only (not the card/tree/details placements of the shared component): the wip
	   badge sits ~1px low against the other pills in this row, so lift just this instance. */
	.status-group gl-wip-stats {
		transform: translateY(-0.1rem);
	}

	.agents {
		display: flex;
		flex-flow: row wrap;
		gap: var(--gl-space-4);
		align-items: center;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-4);
	}

	/* WIP breakdown is fetched lazily on hover, so a dirty branch can be open before its counts land.
	   Without these the pill would render empty (and stay empty on failure) with nothing to explain it. */
	.wip-status {
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
	}

	/* Unpushed commits on a branch with no upstream: gl-tracking-status renders nothing without one, so
	   surface them as an outlined indicator box matching the neighboring pills — same 1rem / line-height:1
	   / 0.2rem 0.4rem geometry as the shared .pill--outlined, just the ahead arrow (meaning in the tooltip). */
	.unpublished {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.4rem;
		font-size: 1rem;
		line-height: 1;
		color: var(--gl-tracking-ahead, #4ec9b0);
		border: var(--gl-border-width) solid color-mix(in srgb, transparent 80%, var(--color-foreground));
		border-radius: var(--gl-radius-sm);
	}

	/* Match the box's line box so the arrow sizes to ~1rem (not code-icon's 16px default) and centers
	   cleanly — the same recipe wip-stats uses for its badge icon. The small translate is an optical
	   correction: the arrow-up glyph's ink sits ~1px right of its advance center, so it reads off-center
	   in an otherwise symmetric box. transform, so it nudges only the glyph, not the box geometry. */
	.unpublished code-icon {
		font-size: inherit;
		line-height: inherit;
		transform: translateX(-0.1rem);
	}
`;
