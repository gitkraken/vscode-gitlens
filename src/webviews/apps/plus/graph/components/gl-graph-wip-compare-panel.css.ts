import { css } from 'lit';

export const wipComparePanelStyles = css`
	:host {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		/* Matches the fade+slide-up entrance used by other graph details sub-panels so
		   compare mode animates in like review / compose instead of popping. */
		animation: sub-panel-enter 0.2s ease-out;
	}

	@media (prefers-reduced-motion: reduce) {
		:host {
			animation: none;
		}
	}

	.wip-compare-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	/* Skeleton — only the commit-list area; bar + tabs render immediately from props. */

	.wip-compare-list-skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		padding: 0.8rem 1.2rem;
	}

	.wip-compare-list-skeleton skeleton-loader {
		--skeleton-line-height: 2.4;
	}

	/* Compare bar: left ref / WT toggle / swap / right ref. The swap chip gets explicit
	   inline margins so the WT toggle doesn't visually merge with it. */

	.wip-compare-bar {
		display: flex;
		align-items: center;
		gap: 1.2rem;
		padding: 0.5rem 1.2rem;
		background: var(--color-background--level-05);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
		flex: none;
	}

	.wip-compare-bar__group {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		flex: 1 1 0;
	}

	/* Refs flex equally so neither dominates; min-width:0 lets the inner button ellipsize.
	   The right-side ref also flexes 1 1 0 so the layout stays balanced. */
	.wip-compare-ref {
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
	}

	.wip-compare-ref--ahead {
		--gl-branch-color: var(--gl-tracking-ahead, #4ec9b0);
	}

	.wip-compare-ref--behind {
		--gl-branch-color: var(--gl-tracking-behind, #ce9178);
	}

	/* Tooltip wrappers around the branch buttons must take up flexible space and clip overflow
	   so the inner gl-branch-name's label can ellipsize. Each side gets equal share. */
	.wip-compare-bar > gl-tooltip {
		display: flex;
		min-width: 0;
		flex: 1 1 0;
		overflow: hidden;
	}

	.wip-compare-bar > gl-tooltip > gl-branch-name {
		min-width: 0;
		max-width: 100%;
	}

	.wip-compare-swap {
		flex-shrink: 0;
		margin-inline: 0.2rem;
	}

	.wip-compare-wt-toggle {
		flex-shrink: 0;
	}

	.wip-compare-wt-toggle--active {
		color: var(--gl-tracking-ahead, #4ec9b0);
		background: color-mix(in srgb, var(--gl-tracking-ahead, #4ec9b0) 12%, transparent);
		border-radius: 0.5rem;
	}

	.wip-compare-wt-toggle--active:hover {
		background: color-mix(in srgb, var(--gl-tracking-ahead, #4ec9b0) 18%, transparent);
	}

	/* Tabs — always rendered; inactive tabs use opacity (preserve hue, just dim). */

	.wip-compare-tabs {
		display: flex;
		border-bottom: 2px solid var(--vscode-sideBarSectionHeader-border);
		background: var(--color-background--level-05);
		flex: none;
	}

	.wip-compare-tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.55rem 0.8rem;
		font-size: var(--gl-font-base);
		cursor: pointer;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -2px;
		background: transparent;
		font-family: inherit;
		user-select: none;
		opacity: 0.55;
		transition:
			opacity 0.15s,
			border-color 0.15s,
			background-color 0.15s;
	}

	.wip-compare-tab--ahead {
		color: var(--gl-tracking-ahead, #4ec9b0);
	}

	.wip-compare-tab--behind {
		color: var(--gl-tracking-behind, #ce9178);
	}

	/* Empty tabs: still dimmed (via base opacity), but NOT italic — keeps direction icon legible. */

	.wip-compare-tab:hover {
		background: var(--vscode-list-hoverBackground);
		opacity: 0.85;
	}

	.wip-compare-tab--active-ahead,
	.wip-compare-tab--active-behind {
		opacity: 1;
	}

	.wip-compare-tab--active-ahead {
		border-bottom-color: var(--gl-tracking-ahead, #4ec9b0);
	}

	.wip-compare-tab--active-behind {
		border-bottom-color: var(--gl-tracking-behind, #ce9178);
	}

	.wip-compare-tab__icon {
		--code-icon-size: 12px;
	}

	.wip-compare-tab__label {
		font-weight: 500;
	}

	/* Count badge adopts the tab's tracking hue for BOTH active and inactive states — the
	   inactive dim comes from the parent tab's opacity:0.55, not a different color. This avoids
	   the badge flashing to the default vscode-badge palette when switching tabs. */
	.wip-compare-tab__count {
		font-size: var(--gl-font-micro);
		font-weight: 500;
		padding: 0.2rem 0.4rem;
		border-radius: 0.4rem;
		color: var(--vscode-editor-background, var(--vscode-badge-foreground));
		line-height: 1;
	}

	.wip-compare-tab--ahead .wip-compare-tab__count {
		background-color: color-mix(in srgb, var(--gl-tracking-ahead, #4ec9b0) 90%, transparent);
	}

	.wip-compare-tab--behind .wip-compare-tab__count {
		background-color: color-mix(in srgb, var(--gl-tracking-behind, #ce9178) 90%, transparent);
	}

	/* Split panel — divides the commit list and the files tree vertically. */

	.wip-compare-split {
		flex: 1;
		min-height: 0;
	}

	.wip-compare-split__start,
	.wip-compare-split__end {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	/* Commit list — gl-tree with shared gl-commit-row content. Inherits .scrollable behavior
	   (fade-on-hover) from elementBase via the .scrollable class on the container. */

	.wip-compare-commits {
		height: 100%;
		min-height: 0;
		overflow-y: auto;
		border-bottom: 1px solid
			color-mix(in srgb, var(--color-foreground) 15%, var(--vscode-panel-border, transparent));
	}

	/* Tighten the commit list's leading gutter so rows start near the panel edge instead of
	   inheriting the tree-view's default indent column. Both --gl-tree-indent (gl-tree's own var)
	   and --gitlens-tree-indent (downstream tree-item connector size) need to be zeroed. */
	.wip-compare-commits gl-tree {
		display: block;
		--gl-tree-indent: 0;
		--gitlens-tree-indent: 0;
		padding-inline: 0.4rem;
	}

	.wip-compare-commit {
		--gitlens-gutter-width: 0.4rem;
		--gl-popover-anchor-width: 100%;
		/* Two-line gl-commit-row needs the host to grow past tree-item's default fixed height.
		   Auto + min-height matches the row's natural ~3.4rem (one msg line + meta line + padding). */
		height: auto;
		min-height: 3.4rem;
		line-height: 1.4;
	}

	.wip-compare-commit::part(actions) {
		display: none;
	}

	.wip-compare-commit::part(text) {
		line-height: 1.4;
		display: inline-block;
	}

	.wip-compare-commit::part(main) {
		flex: 1;
		min-width: 0;
		align-items: flex-start;
	}

	/* Selected-commit marker: 3px LEFT edge in the prominent color so the user can see at a
	   glance which row is filtering the file list. Complements the scoped header treatment.
	   Positioned at the very left of the row so it reads as a vertical "rail" indicator. */
	.wip-compare-commit--selected::part(item) {
		box-shadow: inset 3px 0 0 0 var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground));
	}

	/* Empty states */

	.wip-compare-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 1rem 1.2rem;
		font-size: var(--gl-font-base);
		color: var(--color-foreground--50);
		flex: none;
	}

	.wip-compare-empty--no-commits {
		font-style: italic;
	}

	/* Scope-to-commit tag (mirrors the graph header's filtered titlebar tint). */

	.wip-compare-scope-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0.6rem 0.6rem 0 0.6rem;
		padding: 0 0.3rem 0 0.4rem;
		line-height: 1;
		border-radius: 0.3rem;
		font-size: 1.2rem;
		font-weight: normal;
		color: var(--vscode-statusBarItem-prominentForeground, var(--vscode-foreground));
		background: color-mix(
			in srgb,
			var(--vscode-statusBarItem-prominentBackground, var(--vscode-toolbar-hoverBackground)) 30%,
			transparent
		);
		border: 1px solid
			color-mix(
				in srgb,
				var(--vscode-statusBarItem-prominentBackground, var(--vscode-toolbar-hoverBackground)) 55%,
				transparent
			);
		flex: none;
	}

	.wip-compare-scope-tag:hover {
		background: color-mix(
			in srgb,
			var(--vscode-statusBarItem-prominentBackground, var(--vscode-toolbar-hoverBackground)) 42%,
			transparent
		);
	}

	.wip-compare-scope-tag > code-icon {
		flex: none;
		font-size: 1.4rem;
	}

	.wip-compare-scope-tag__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border: none;
		border-radius: 0.2rem;
		margin-left: 0.2rem;
		background: transparent;
		color: inherit;
		opacity: 0.75;
		cursor: pointer;
		padding: 0;
	}

	.wip-compare-scope-tag__close:hover,
	.wip-compare-scope-tag__close:focus-visible {
		background: color-mix(in srgb, currentColor 22%, transparent);
		opacity: 1;
		outline: none;
	}

	/* File tree container */

	.wip-compare-files {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.wip-compare-files webview-pane-group {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.wip-compare-files gl-file-tree-pane::part(header) {
		padding-right: calc(1.2rem - 0.6rem);
		background-color: inherit;
		border-top: 1px solid transparent;
		border-bottom: 1px solid transparent;
	}

	.wip-compare-files--scoped gl-file-tree-pane::part(header) {
		background-color: color-mix(
			in srgb,
			var(--vscode-statusBarItem-prominentBackground, var(--vscode-toolbar-hoverBackground)) 18%,
			transparent
		);
		border-top-color: color-mix(
			in srgb,
			var(--vscode-statusBarItem-prominentBackground, var(--vscode-toolbar-hoverBackground)) 45%,
			transparent
		);
		border-bottom-color: color-mix(
			in srgb,
			var(--vscode-statusBarItem-prominentBackground, var(--vscode-toolbar-hoverBackground)) 30%,
			transparent
		);
	}
`;
