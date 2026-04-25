import { css } from 'lit';

export const wipHeaderStyles = css`
	:host {
		display: contents;
	}

	.graph-details-header__title-group {
		display: flex;
		align-items: center;
		gap: 1.2rem;
		min-width: 0;
		flex: 1;
	}

	.graph-details-header__wip-title {
		min-width: 0;
		font-weight: 500;
		font-size: var(--gl-font-base);
		flex: 0 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Secondary row beneath the WIP title — branch name, tracking pill, and branch ops.
	   Visually matches the metadata bar in single/multi-commit details so the panel chrome
	   reads as one piece (background, top/bottom borders). The shared CSS variables come
	   from gl-details-base.css.ts. */
	.graph-details-header__branch-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.2rem var(--gl-panel-padding-right, 1rem) 0.6rem var(--gl-panel-padding-left, 1.2rem);
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

	.no-changes {
		min-width: 0;
		flex: 0 1 auto;
		color: var(--color-foreground--50);
		font-size: var(--gl-font-base);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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

	/* When no issues row follows, the branch row owns the trailing border instead. */
	.graph-details-header__branch-row:not(:has(+ .graph-details-header__issues)) {
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

	.issue-chip-group__remove:hover,
	.issue-chip-group__remove:focus-visible {
		color: var(--vscode-errorForeground);
		outline: none;
	}

	.associate-issue-action {
		flex-shrink: 0;
		color: var(--color-foreground--65);
	}

	.associate-issue-action--trailing {
		margin-left: auto;
	}
`;
