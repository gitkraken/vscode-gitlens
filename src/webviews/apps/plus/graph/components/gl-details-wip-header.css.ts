import { css } from 'lit';

export const detailsWipHeaderStyles = css`
	:host {
		display: contents;
		--mode-header-bg: var(--titlebar-bg, var(--color-background--level-05));
	}

	.graph-details-header__title-group {
		display: flex;
		align-items: center;
		gap: 1.2rem;
		min-width: 0;
		flex: 1;
		--commit-stats-pill-line-height: 2rem;
	}

	.graph-details-header__wip-title {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		font-weight: 500;
		font-size: var(--gl-font-base);
		flex: 0 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The stats pill is the informative part of the title row, so it never shrinks — the
	   "Working Changes" label (static text) ellipsizes away first as the panel narrows. */
	.graph-details-header__title-group > gl-wip-stats {
		flex: none;
	}

	/* Below this the leftover for the label is a useless sliver — drop it entirely so the pill
	   keeps every remaining pixel (scoped via :has so mode-active titles, which have no pill
	   beside them, keep their label). The pill itself never yields; on extreme widths its tail
	   clips, and partial counts still beat none. The container is the host header's row (a
	   flat-tree ancestor, so the query crosses the shadow boundary). */
	@container gl-action-chip-host (max-width: 340px) {
		.graph-details-header__title-group:has(gl-wip-stats) .graph-details-header__wip-title {
			display: none;
		}
	}

	/* Mode icon prefixed to the title in compose/review — same icon as the active chip
	   so the visual link reinforces what mode you're in. */
	.graph-details-header__mode-icon {
		flex: 0 0 auto;
	}

	.graph-details-header__paused-op {
		display: flex;
		align-items: center;
		padding: 0.4rem var(--gl-panel-padding-right, 1rem) 0.4rem var(--gl-panel-padding-left, 1.2rem);
		background-color: var(--gl-metadata-bar-bg);
		border-bottom: 1px solid var(--gl-metadata-bar-border);
	}

	.graph-details-header__paused-op > gl-merge-rebase-status {
		flex: 1;
		min-width: 0;
	}

	/* The paused-op row trails the metadata strip; drop the prior row's bottom border so the
	   chunk reads as one tinted strip with paused-op carrying the trailing border. */
	.graph-details-header__branch-row:has(+ .graph-details-header__paused-op),
	.graph-details-header__issues:has(+ .graph-details-header__paused-op) {
		border-bottom: 0;
	}

	/* Secondary row beneath the WIP title — branch name, tracking pill, and branch ops.
	   Visually matches the metadata bar in single/multi-commit details so the panel chrome
	   reads as one piece (background, top/bottom borders). The shared CSS variables come
	   from gl-details-base.css.ts. */
	.graph-details-header__branch-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.2rem var(--gl-panel-padding-right, 1rem) 0.2rem var(--gl-panel-padding-left, 1.2rem);
		min-height: var(--gl-metadata-bar-min-height, 3.2rem);
		background-color: var(--gl-metadata-bar-bg);
		border-top: 1px solid var(--gl-metadata-bar-border);
	}

	/* When the issues row follows, drop the branch row's bottom border so the two rows
	   read as a single tinted strip; the issues row carries the trailing border. */
	.graph-details-header__branch-row:has(+ .graph-details-header__issues) {
		padding-bottom: 0.4rem;
	}

	.branch-identity,
	.branch-ops {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 2.4rem;
		--commit-stats-pill-line-height: 2rem;
		--gl-pill-line-height: 2rem;
		--gl-pill-min-height: 2rem;
		--gl-pill-padding: 0 0.6rem;
		--gl-pill-font-size: 1.1rem;
		--gl-pill-border-radius: 0.4rem;
	}

	.branch-identity {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* The branch-name is wrapped in a gl-tooltip that defaults to display:block,
	   preventing the chip from shrinking at narrow panel widths. */
	.branch-identity > gl-tooltip {
		display: flex;
		align-items: center;
		min-width: 0;
		flex: 0 1 auto;
	}

	.branch-ops {
		flex: 0 0 auto;
		margin-left: auto;
	}

	/* Right-side mode-status snippet (only present when in compose/review). Replaces the
	   branch-ops cluster slot with text describing the mode's current state — scope file
	   count, "Generating…", commit/finding counts, or "Error". Pre-formatted by the host so
	   we just render whatever string lands here. */
	.mode-status {
		flex: 0 0 auto;
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.8rem;
		font-size: var(--gl-font-small, 1.2rem);
		color: var(--color-foreground--65);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mode-status__group {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.mode-status__group code-icon {
		--code-icon-size: 1.2rem;
		--code-icon-v-align: text-bottom;
		opacity: 0.85;
	}

	/* Clickable "Resume" affordance — replaces the in-panel resume bar. Active when a back-preview
	   snapshot is present (forward-available state). The whole pill is the click target. */
	.mode-status__resume {
		display: inline-flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.2rem 0.6rem;
		font: inherit;
		color: inherit;
		background: transparent;
		border: none;
		border-radius: 0.4rem;
		cursor: pointer;
	}

	.mode-status__resume:hover {
		background: var(--vscode-toolbar-hoverBackground);
		color: var(--vscode-foreground);
	}

	.mode-status__resume:focus-visible {
		background: var(--vscode-toolbar-hoverBackground);
		color: var(--vscode-foreground);
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
	}

	.mode-status__resume-verb {
		font-weight: 500;
	}

	.mode-status__resume-arrow {
		--code-icon-size: 1.2rem;
		--code-icon-v-align: text-bottom;
		opacity: 0.85;
	}

	.graph-details-header__branch-link {
		display: inline-flex;
		align-items: center;
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.graph-details-header__branch {
		min-width: 0;
		max-width: 20rem;
		flex: 0 1 auto;
	}

	.graph-details-header__merge-target {
		display: inline-flex;
		align-items: center;
	}

	.graph-details-header__merge-target-slot {
		display: inline-flex;
		align-items: center;
		min-width: 3.9rem;
		min-height: 2.4rem;
	}

	.graph-details-header__pull-request {
		flex: 0 1 auto;
		min-width: 0;
	}

	.graph-details-header__pull-request--loading {
		display: inline-flex;
		min-width: 3.9rem;
		min-height: 2.4rem;
	}

	.graph-details-header__issues {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem var(--gl-panel-padding-right, 1rem) 0.4rem var(--gl-panel-padding-left, 1.2rem);
		min-width: 0;
		font-size: var(--gl-font-sm);
		background-color: var(--gl-metadata-bar-bg);
		border-bottom: 1px solid var(--gl-metadata-bar-border);
		--gl-chip-overflow-gap: 0.4rem;
	}

	/* When no issues row and no paused-op row follow, the branch row owns the trailing
	   border instead. */
	.graph-details-header__branch-row:not(:has(+ .graph-details-header__issues, + .graph-details-header__paused-op)) {
		border-bottom: 1px solid var(--gl-metadata-bar-border);
	}

	.graph-details-header__issues-chips {
		flex: 1 1 auto;
		min-width: 0;
	}

	.issue-chip-group {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		border-radius: 0.5rem;
		transition: background-color 150ms ease-out;
	}

	.issue-chip-group:hover,
	.issue-chip-group:focus-within {
		background-color: var(--vscode-toolbar-hoverBackground);
	}

	.issue-chip-group gl-autolink-chip {
		min-width: 0;
	}

	.issue-chip-group__remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2rem;
		background: none;
		border: none;
		padding: 0 0.4rem;
		margin-left: -0.2rem;
		color: var(--color-foreground--50);
		cursor: pointer;
		border-radius: 0 0.5rem 0.5rem 0;
		opacity: 0;
		transition:
			opacity 150ms ease-out,
			color 150ms ease-out;
	}

	.issue-chip-group:hover .issue-chip-group__remove,
	.issue-chip-group:focus-within .issue-chip-group__remove {
		opacity: 1;
	}

	.issue-chip-group__remove:hover {
		color: var(--vscode-errorForeground);
	}

	.issue-chip-group__remove:focus-visible {
		color: var(--vscode-errorForeground);
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
	}

	.associate-issue-action {
		flex-shrink: 0;
		color: var(--color-foreground--65);
	}

	.associate-issue-action--trailing {
		margin-left: auto;
	}
`;
