import { css } from 'lit';

export const compareModePanelStyles = css`
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
		position: relative;
	}

	.wip-compare-panel > progress-indicator {
		top: 0;
	}

	/* Compare bar: left ref / WT toggle / swap / right ref. The swap chip gets explicit
	   inline margins so the WT toggle doesn't visually merge with it. */

	.wip-compare-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		min-width: 0;
		padding: 0.5rem 1.2rem;
		background: var(--gl-metadata-bar-bg);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
		flex: none;
	}

	.wip-compare-bar__group {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		flex: 0 1 auto;
	}

	.wip-compare-bar__group gl-branch-name {
		min-width: 5rem;
		overflow: hidden;
	}

	/* Refs flex equally so neither dominates.
	   The right-side ref also flexes 0 1 auto so it can shrink under tight viewports. */
	.wip-compare-ref {
		min-width: 2.5rem;
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
	   so the inner gl-branch-name's label can ellipsize. */
	.wip-compare-bar > gl-tooltip,
	.wip-compare-bar__group > gl-tooltip {
		display: flex;
		min-width: 2.5rem;
		flex: 0 1 auto;
		overflow: hidden;
	}

	.wip-compare-bar > gl-tooltip > gl-branch-name,
	.wip-compare-bar__group > gl-tooltip > gl-branch-name {
		min-width: 5rem;
		max-width: 100%;
		overflow: hidden;
	}

	.wip-compare-swap {
		flex: 0 0 auto;
		margin-inline: 0.2rem;
	}

	.wip-compare-wt-toggle {
		flex: 0 0 auto;
	}

	.wip-compare-refresh {
		flex: 0 0 auto;
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
		flex: none;
	}

	.wip-compare-error {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 1.2rem;
		color: var(--vscode-editorError-foreground);
		background: var(--vscode-inputValidation-errorBackground);
		border-bottom: 1px solid var(--vscode-inputValidation-errorBorder);
		font-size: var(--gl-font-base);
		flex: none;
	}

	.wip-compare-stale {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 1.2rem;
		color: var(--vscode-inputValidation-warningForeground);
		background: var(--vscode-inputValidation-warningBackground);
		border-bottom: 1px solid var(--vscode-inputValidation-warningBorder);
		font-size: var(--gl-font-base);
		flex: none;
	}

	.wip-compare-stale span {
		min-width: 0;
		flex: 1 1 auto;
	}

	.wip-compare-stale gl-action-chip {
		flex: 0 0 auto;
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

	.wip-compare-tab--all {
		color: var(--vscode-foreground);
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

	.wip-compare-tab--active-all,
	.wip-compare-tab--active-ahead,
	.wip-compare-tab--active-behind {
		opacity: 1;
	}

	.wip-compare-tab--active-all {
		border-bottom-color: var(--vscode-foreground);
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

	.wip-compare-tab--all .wip-compare-tab__count {
		background-color: color-mix(in srgb, var(--vscode-foreground) 60%, transparent);
	}

	.wip-compare-tab--ahead .wip-compare-tab__count {
		background-color: color-mix(in srgb, var(--gl-tracking-ahead, #4ec9b0) 90%, transparent);
	}

	.wip-compare-tab--behind .wip-compare-tab__count {
		background-color: color-mix(in srgb, var(--gl-tracking-behind, #ce9178) 90%, transparent);
	}

	/* All Files mode — full-width file tree, no commit pane. */

	.wip-compare-all {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
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

	.wip-compare-split__start {
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	/* Commit list scrollbar is gated to commit-list hover/focus-within (not the host-hover
	   pattern from scrollableBase) so it doesn't flash when the user hovers the file pane. */

	.wip-compare-commits {
		height: 100%;
		min-height: 0;
		overflow-y: auto;
	}

	.wip-compare-commits.scrollable {
		border-color: transparent;
		transition: border-color 1s linear;
	}

	.wip-compare-commits.scrollable:hover,
	.wip-compare-commits.scrollable:focus-within {
		border-color: var(--vscode-scrollbarSlider-background);
		transition: none;
	}

	:host(:hover) .wip-compare-commits.scrollable:not(:hover):not(:focus-within),
	:host(:focus-within) .wip-compare-commits.scrollable:not(:hover):not(:focus-within) {
		border-color: transparent;
	}

	/* Zero out the tree's indent columns (flat list — no nesting). No outer padding here;
	   horizontal insets live on the tree-item host so they match the scope-pane row rhythm. */
	.wip-compare-commits gl-tree {
		display: block;
		--gl-tree-indent: 0;
		--gitlens-tree-indent: 0;
	}

	/* Minimal insets so the row content hugs the panel edges. Left gutter is just enough that the
	   3px selected-row rail (drawn as an inset shadow on the host) sits flush against the avatar
	   without overlapping it. Padding-y is small; the row's natural two-line height drives height. */
	.wip-compare-commit {
		--gitlens-gutter-width: 0.3rem;
		--gl-popover-anchor-width: 100%;
		--gl-tree-item-min-height: 2.4rem;
		--gl-tree-item-padding-y: 0.2rem;
		padding-right: 0.2rem;
	}

	/* This consumer doesn't slot any actions; tree-item's show-on-hover behavior would otherwise
	   add a 0.4rem margin on hover and shift the date column leftward each time. Hide outright. */
	.wip-compare-commit::part(actions) {
		display: none;
	}

	/* Selected/scoping commit row — full-row tint + 3px left rail in the same warning hue used
	   by the graph header's focus-branch scope chip (both pull from --vscode-statusBarItem-
	   warningBackground). The shared color says "this row is the active scope filtering the file
	   pane below". The tint OVERRIDES tree-item's default --vscode-list-*SelectionBackground so
	   the row reads as a scope indicator, not a generic list selection. The rail is on the host
	   (not ::part(item)) so it sits flush with the panel edge. */
	.wip-compare-commit--selected,
	.wip-compare-commit--selected:hover {
		background-color: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 18%, transparent);
		box-shadow: inset 3px 0 0 0 var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground));
	}

	/* Strengthen the tint when the selected row is also focused (keyboard / active click) so the
	   focused state still reads through the warning tint. */
	.wip-compare-commit--selected[focused],
	.wip-compare-commit--selected:focus-within {
		background-color: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 28%, transparent);
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

	/* Scope chip uses the SAME warning hue as the selected row + the graph header's focus-branch
	   scope chip (mode-chip--scoped). Three indicators of the same scope state line up in color. */
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
		color: var(--vscode-statusBarItem-warningForeground, var(--vscode-foreground));
		background: color-mix(
			in srgb,
			var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground)) 30%,
			transparent
		);
		border: 1px solid
			color-mix(
				in srgb,
				var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground)) 55%,
				transparent
			);
		flex: none;
	}

	.wip-compare-scope-tag:hover {
		background: color-mix(
			in srgb,
			var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground)) 42%,
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

	.wip-compare-files :is(gl-file-tree-pane, webview-pane)::part(header) {
		padding-right: calc(1.2rem - 0.6rem);
		background-color: inherit;
		border-top: none;
	}

	/* Match the inline-flex/gap treatment that gl-file-tree-pane applies to its title slot, so the
	   Contributors header (selector + count badge) aligns identically to the Files Changed header. */
	.wip-compare-contributors-title {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	/* Line-stats summary in the file pane header. Color matches the per-file +N -N annotations. */
	.wip-compare-stats {
		display: inline-flex;
		gap: 0.6rem;
		margin-inline-start: 0.4rem;
		font-size: var(--gl-font-micro);
		font-weight: normal;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.wip-compare-stats__additions {
		color: var(--vscode-gitDecoration-addedResourceForeground);
	}

	.wip-compare-stats__deletions {
		color: var(--vscode-gitDecoration-deletedResourceForeground);
	}

	/* Scoped file-pane header uses the SAME warning hue as the selected commit row + the graph
	   header's focus-branch scope chip — visual rhyme tells the user "this header is scoped to the
	   row that's highlighted above". The base gl-file-tree-pane.css strips border-top with
	   !important (intentional default for the unscoped case); we restore it here with !important
	   so the scoped header reads as its own banded region. */
	.wip-compare-files--scoped gl-file-tree-pane::part(header) {
		background-color: color-mix(
			in srgb,
			var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground)) 18%,
			transparent
		);
		border-top: 1px solid
			color-mix(
				in srgb,
				var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground)) 60%,
				transparent
			) !important;
		border-bottom: 1px solid
			color-mix(
				in srgb,
				var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground)) 40%,
				transparent
			);
	}

	/* Autolinks chip strip — mirrors the multi-select compare panel's .compare-enrichment
	   treatment (font-size, padding, color tweak for the autolink-settings info chip) so the
	   "No Autolinks Found" affordance reads identically across both panels.
	   Allows the chip strip to wrap to multiple rows when there are too many to fit one line. */
	.wip-compare-enrichment {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.4rem 1.2rem;
		font-size: var(--gl-font-sm);
		flex: none;
		min-width: 0;
	}

	.wip-compare-enrichment gl-action-chip[data-action='autolink-settings'] {
		color: var(--color-foreground--65);
		--code-icon-size: 12px;
	}

	.wip-compare-enrichment gl-action-chip::part(base) {
		gap: 0.4rem;
	}

	.wip-compare-enrichment gl-action-chip::part(icon) {
		line-height: 1;
		display: inline-flex;
		align-items: center;
	}

	/* Files / Contributors view selector — slotted into the pane's title slot, so it must
	   visually sit inline with the title text it replaces (no margin/padding around the
	   popover; the trigger button supplies its own hit-target padding). The 0-padding
	   tooltip override removes the body inset so menu rows hug the popover edges. */
	.wip-compare-view-selector {
		display: inline-flex;
		--sl-tooltip-padding: 0;
	}

	.wip-compare-view-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: transparent;
		border: 1px solid transparent;
		color: inherit;
		font-family: inherit;
		font-size: inherit;
		font-weight: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		padding: 0.1rem 0.4rem;
		margin-inline-start: -0.4rem;
		border-radius: 3px;
		cursor: pointer;
	}

	.wip-compare-view-trigger:hover,
	.wip-compare-view-trigger:focus-visible {
		background: var(--vscode-toolbar-hoverBackground);
		outline: none;
	}

	.wip-compare-view-trigger__label {
		text-transform: inherit;
		letter-spacing: inherit;
	}

	/* Reset inherited title styles inside the popover menu. text-transform/letter-spacing
	   are inheritable AND cross slot boundaries, so without this the menu items render in
	   the pane title's uppercase tracking. Also normalize weight + spacing for clean rows.
	   menu-list has a default padding-bottom: 0.6rem — zero it so rows hug the popover. */
	.wip-compare-view-menu {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		text-transform: none;
		letter-spacing: normal;
		font-weight: normal;
		font-size: var(--gl-font-base);
		min-width: 16rem;
		padding: 0.4rem 0;
	}

	.wip-compare-view-menu menu-item {
		display: flex;
		align-items: center;
	}

	.wip-compare-view-menu menu-item code-icon {
		margin-right: 0.6rem;
		opacity: 0.75;
	}

	/* Contributors list */
	.wip-compare-contributors {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		flex: 1 1 auto;
		overflow-y: auto;
	}

	.wip-compare-contributors--loading,
	.wip-compare-contributors--empty,
	.wip-compare-files--loading {
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		color: var(--vscode-descriptionForeground);
		padding: 2rem 1.2rem;
	}

	/* File-section loading container — sits in the gl-file-tree-pane "before-tree" slot in place
	   of the "No changes" empty text while the comparison is being recomputed. */
	.wip-compare-files--loading {
		display: flex;
		text-align: center;
	}

	/* Per-side loading container — replaces the entire split-panel (commit list + files) when
	   the side's Phase 2 fetch hasn't returned yet. Centered fill so the user sees the panel
	   is working, not empty. */
	.wip-compare-side-loading {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		color: var(--vscode-descriptionForeground);
		padding: 2rem 1.2rem;
	}

	/* Inline autolinks loading state — slots into the chip-overflow as a single non-chip
	   pseudo-row, replacing the "No autolinks found" affordance during a comparison change. */
	.wip-compare-enrichment__loading {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
	}

	/* Badge spinner — match the count text size so a "3"→spinner→"5" transition doesn't shift
	   tab widths. line-height:1 keeps the badge height locked. */
	.wip-compare-tab__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.wip-compare-tab__count-spinner {
		--code-icon-size: var(--gl-font-micro);
		line-height: 1;
	}

	.wip-compare-contributor {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.5rem 1.2rem;
		min-width: 0;
	}

	.wip-compare-contributor:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.wip-compare-contributor gl-avatar {
		flex: none;
		width: 24px;
		height: 24px;
	}

	.wip-compare-contributor__info {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1 1 auto;
		gap: 0.1rem;
	}

	.wip-compare-contributor__name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.wip-compare-contributor__you {
		font-weight: 400;
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
		margin-left: 0.3rem;
	}

	.wip-compare-contributor__stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		color: var(--vscode-descriptionForeground);
		font-size: 1.1rem;
	}

	.wip-compare-contributor__diffstat {
		display: inline-flex;
		gap: 0.4rem;
	}

	.wip-compare-contributor__additions {
		color: var(--vscode-gitDecoration-addedResourceForeground);
	}

	.wip-compare-contributor__deletions {
		color: var(--vscode-gitDecoration-deletedResourceForeground);
	}
`;
