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

	.compare-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		position: relative;
	}

	.compare-panel > progress-indicator {
		top: 0;
	}

	/* Compare bar: refs cluster (leftRef + WT toggle + swap + rightRef tight together) on the left,
	   actions cluster (refresh + open-in-S&C) on the right. The only visible gap in the bar lives
	   between those two clusters — justify-content space-between distributes excess space there
	   instead of fragmenting it across three children. */

	.compare-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		min-width: 0;
		padding: 0.5rem 1.2rem;
		background: var(--gl-metadata-bar-bg);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
		color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
		flex: none;
	}

	.compare-bar__refs {
		display: flex;
		align-items: center;
		gap: 0.1rem;
		min-width: 0;
		flex: 0 1 auto;
	}

	.compare-bar__actions {
		display: flex;
		align-items: center;
		gap: 0.1rem;
		flex: 0 0 auto;
	}

	.compare-bar__refs gl-branch-name {
		min-width: 5rem;
		overflow: hidden;
	}

	/* Refs flex equally so neither dominates.
	   The right-side ref also flexes 0 1 auto so it can shrink under tight viewports. */
	.compare-ref {
		min-width: 2.5rem;
		max-width: 100%;
		overflow: hidden;
	}

	.compare-ref--ahead {
		--gl-branch-color: var(--gl-tracking-ahead, #4ec9b0);
	}

	.compare-ref--behind {
		--gl-branch-color: var(--gl-tracking-behind, #ce9178);
	}

	/* Tooltip wrappers around the branch buttons must take up flexible space and clip overflow
	   so the inner gl-branch-name's label can ellipsize. */
	.compare-bar__refs > gl-tooltip {
		display: flex;
		min-width: 2.5rem;
		flex: 0 1 auto;
		overflow: hidden;
	}

	.compare-bar__refs > gl-tooltip > gl-branch-name {
		min-width: 5rem;
		max-width: 100%;
		overflow: hidden;
	}

	/* Role icons (target / git-compare) sit immediately before each branch button to identify
	   the Base and Compare sides. They're informational only — fixed size, no flex contribution,
	   no overflow clipping. */
	.compare-bar__refs > gl-tooltip:has(> .compare-role-icon) {
		min-width: 0;
		flex: 0 0 auto;
		overflow: visible;
		align-items: center;
	}

	.compare-role-icon {
		flex: 0 0 auto;
		margin-inline: 0.2rem 0.3rem;
		opacity: 0.55;
	}

	/* "Load More Commits" affordance at the bottom of an Ahead/Behind commit list. Styled to
	   mirror the scope-pane's load-more row (see gl-commits-scope-pane.css.ts) so the pattern
	   is consistent across surfaces — a row-like button with a chevron-down icon, disabled +
	   spinning while a fetch is in flight. */
	.compare-load-more {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.6rem 1.2rem;
		border: none;
		background: transparent;
		color: var(--vscode-descriptionForeground);
		font: inherit;
		text-align: left;
		cursor: pointer;
		/* Constrain the button's outer width so width:100% + horizontal padding don't push
		   it past the wrapper's box and trigger a horizontal scrollbar on a narrow panel. */
		box-sizing: border-box;
	}

	.compare-load-more:hover:not(:disabled) {
		background: var(--vscode-list-hoverBackground);
		color: var(--vscode-foreground);
	}

	.compare-load-more:disabled {
		cursor: default;
		opacity: 0.7;
	}

	.compare-swap {
		flex: 0 0 auto;
		margin-inline: 0.4rem;
	}

	.compare-wt-toggle {
		flex: 0 0 auto;
	}

	.compare-refresh {
		flex: 0 0 auto;
	}

	.compare-wt-toggle--active {
		color: var(--gl-tracking-ahead, #4ec9b0);
		background: color-mix(in srgb, var(--gl-tracking-ahead, #4ec9b0) 12%, transparent);
		border-radius: 0.5rem;
	}

	.compare-wt-toggle--active:hover {
		background: color-mix(in srgb, var(--gl-tracking-ahead, #4ec9b0) 18%, transparent);
	}

	/* Tabs — always rendered; inactive tabs use opacity (preserve hue, just dim). */

	.compare-tabs {
		display: flex;
		border-bottom: 2px solid var(--vscode-sideBarSectionHeader-border);
		flex: none;
	}

	.compare-error {
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

	.compare-stale {
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

	.compare-stale span {
		min-width: 0;
		flex: 1 1 auto;
	}

	.compare-stale gl-action-chip {
		flex: 0 0 auto;
	}

	.compare-tab {
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

	.compare-tab--all {
		color: var(--vscode-foreground);
	}

	.compare-tab--ahead {
		color: var(--gl-tracking-ahead, #4ec9b0);
	}

	.compare-tab--behind {
		color: var(--gl-tracking-behind, #ce9178);
	}

	/* Empty tabs: still dimmed (via base opacity), but NOT italic — keeps direction icon legible. */

	.compare-tab:hover {
		background: var(--vscode-list-hoverBackground);
		opacity: 0.85;
	}

	.compare-tab--active-all,
	.compare-tab--active-ahead,
	.compare-tab--active-behind {
		opacity: 1;
	}

	.compare-tab--active-all {
		border-bottom-color: var(--vscode-foreground);
	}

	.compare-tab--active-ahead {
		border-bottom-color: var(--gl-tracking-ahead, #4ec9b0);
	}

	.compare-tab--active-behind {
		border-bottom-color: var(--gl-tracking-behind, #ce9178);
	}

	.compare-tab__label {
		font-weight: 500;
	}

	/* Count badge adopts the tab's tracking hue for BOTH active and inactive states — the
	   inactive dim comes from the parent tab's opacity:0.55, not a different color. This avoids
	   the badge flashing to the default vscode-badge palette when switching tabs. */
	.compare-tab__count {
		font-size: var(--gl-font-micro);
		font-weight: 500;
		padding: 0.2rem 0.4rem;
		border-radius: 0.4rem;
		color: var(--vscode-editor-background, var(--vscode-badge-foreground));
		line-height: 1;
	}

	.compare-tab--all .compare-tab__count {
		background-color: color-mix(in srgb, var(--vscode-foreground) 60%, transparent);
	}

	.compare-tab--ahead .compare-tab__count {
		background-color: color-mix(in srgb, var(--gl-tracking-ahead, #4ec9b0) 90%, transparent);
	}

	.compare-tab--behind .compare-tab__count {
		background-color: color-mix(in srgb, var(--gl-tracking-behind, #ce9178) 90%, transparent);
	}

	/* All Files mode — full-width file tree, no commit pane. */

	.compare-all {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* Single-line notice band above the AI row on the All Files tab — telegraphs that this tab
	   is a unified diff (no commit list) and directs users at Ahead/Behind for per-commit views.
	   Uses the same 1.2rem horizontal padding as .compare-enrichment so left/right edges line up
	   with the autolinks row that Ahead/Behind tabs render in this slot. */
	.compare-all-notice {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1rem 1.2rem;
		font-size: 1.2rem;
		color: var(--color-foreground--65);
		flex: none;
		min-width: 0;
	}

	.compare-all-notice code-icon {
		flex: none;
		--code-icon-size: 12px;
	}

	.compare-all-notice span {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.compare-all-notice strong {
		font-weight: 600;
	}

	/* Breathing room between the AI actions row (Explain input + Generate Changelog) and the
	   FILES CHANGED / Contributors section header that follows. The autolinks row above
	   contributes 0.4rem padding-bottom on its own; this margin-bottom adds the rest of the
	   gap below the action row so the FILES CHANGED border reads as a distinct band.
	   Horizontal margins must stay auto so panelActionInputStyles can center the row at its
	   --gl-max-input cap — overriding with fixed left/right margins (as we did before) broke
	   that and left the row visibly left-aligned with empty space on the right. */
	.compare-panel gl-compare-ai-actions {
		display: block;
		margin: 0 auto 0.6rem;
	}

	/* Split panel — divides the commit list and the files tree vertically. */

	.compare-split {
		flex: 1;
		min-height: 0;
	}

	.compare-split__start,
	.compare-split__end {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.compare-split__start {
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	/* Commit list scrollbar is gated to commit-list hover/focus-within (not the host-hover
	   pattern from scrollableBase) so it doesn't flash when the user hovers the file pane. */

	.compare-commits {
		height: 100%;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.compare-commits.scrollable {
		border-color: transparent;
		transition: border-color 1s linear;
	}

	.compare-commits.scrollable:hover,
	.compare-commits.scrollable:focus-within {
		border-color: var(--vscode-scrollbarSlider-background);
		transition: none;
	}

	:host(:hover) .compare-commits.scrollable:not(:hover):not(:focus-within),
	:host(:focus-within) .compare-commits.scrollable:not(:hover):not(:focus-within) {
		border-color: transparent;
	}

	/* Zero out the tree's indent columns (flat list — no nesting). No outer padding here;
	   horizontal insets live on the tree-item host so they match the scope-pane row rhythm.
	   Override gl-tree's default :host height (100%) to auto so the element sizes to its
	   children's total height — otherwise gl-tree's box stays viewport-tall while children
	   overflow below into the scroll area, and any sibling (e.g. the load-more row) would be
	   visually overlapped by the overflowing children instead of flowing after them. */
	.compare-commits gl-tree {
		display: block;
		height: auto;
		--gl-tree-indent: 0;
		--gitlens-tree-indent: 0;
	}

	/* Inset matches the file tree below so the avatar column and the FILES CHANGED icons land on
	   the same vertical guide — file-tree gl-tree-items inherit --gitlens-gutter-width: 20px from
	   the global properties default, and we explicitly mirror that here (the original 0.3rem was
	   too tight to align with the file rows). The 3px selected-row rail (drawn as an inset
	   box-shadow on the host) sits flush to the panel edge regardless of this padding, so the
	   wider gutter doesn't push it inward. Padding-y is small; the row's natural two-line height
	   drives height. */
	.compare-commit {
		--gitlens-gutter-width: 2rem;
		--gl-popover-anchor-width: 100%;
		--gl-tree-item-min-height: 2.4rem;
		--gl-tree-item-padding-y: 0.2rem;
		padding-right: 0.2rem;
	}

	/* This consumer doesn't slot any actions; tree-item's show-on-hover behavior would otherwise
	   add a 0.4rem margin on hover and shift the date column leftward each time. Hide outright. */
	.compare-commit::part(actions) {
		display: none;
	}

	/* Selected/scoping commit row — full-row tint + 3px left rail in the same warning hue used
	   by the graph header's focus-branch scope chip (both pull from --vscode-statusBarItem-
	   warningBackground). The shared color says "this row is the active scope filtering the file
	   pane below". The tint OVERRIDES tree-item's default --vscode-list-*SelectionBackground so
	   the row reads as a scope indicator, not a generic list selection. The rail is on the host
	   (not ::part(item)) so it sits flush with the panel edge. */
	.compare-commit--selected,
	.compare-commit--selected:hover {
		background-color: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 18%, transparent);
		box-shadow: inset 3px 0 0 0 var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground));
	}

	/* Strengthen the tint when the selected row is also focused (keyboard / active click) so the
	   focused state still reads through the warning tint. */
	.compare-commit--selected[focused],
	.compare-commit--selected:focus-within {
		background-color: color-mix(in srgb, var(--vscode-statusBarItem-warningBackground) 28%, transparent);
	}

	/* Empty states */

	.compare-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 1rem 1.2rem;
		font-size: var(--gl-font-base);
		color: var(--color-foreground--50);
		flex: none;
	}

	.compare-empty--no-commits {
		font-style: italic;
	}

	/* Scope-to-commit tag (mirrors the graph header's filtered titlebar tint). */

	/* Scope chip uses the SAME warning hue as the selected row + the graph header's focus-branch
	   scope chip (mode-chip--scoped). Three indicators of the same scope state line up in color. */
	.compare-scope-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0.6rem;
		padding: 0.1rem 0.3rem 0.1rem 0.4rem;
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

	.compare-scope-tag:hover {
		background: color-mix(
			in srgb,
			var(--vscode-statusBarItem-warningBackground, var(--vscode-toolbar-hoverBackground)) 42%,
			transparent
		);
	}

	.compare-scope-tag > code-icon {
		flex: none;
		font-size: 1.4rem;
	}

	.compare-scope-tag__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		border: none;
		border-radius: 0.2rem;
		margin-left: 0.1rem;
		background: transparent;
		color: inherit;
		opacity: 0.75;
		cursor: pointer;
		padding: 0;
	}

	.compare-scope-tag__close:hover,
	.compare-scope-tag__close:focus-visible {
		background: color-mix(in srgb, currentColor 22%, transparent);
		opacity: 1;
		outline: none;
	}

	/* File tree container */

	.compare-files {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	.compare-files webview-pane-group {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.compare-files :is(gl-file-tree-pane, webview-pane)::part(header) {
		padding-right: calc(1.2rem - 0.6rem);
		background-color: inherit;
	}

	.compare-files gl-file-tree-pane {
		--gl-file-tree-pane-header-border-top: none;
	}

	/* Match the inline-flex/gap treatment that gl-file-tree-pane applies to its title slot, so the
	   Contributors header (selector + count badge) aligns identically to the Files Changed header. */
	.compare-contributors-title {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	/* Line-stats summary in the file pane header. Color matches the per-file +N -N annotations.
	   Stats yield width FIRST — shrink priority is far higher than the title (10) and badge
	   (1) so the whole stats block clips out before the title text starts truncating. */
	.compare-stats {
		display: inline-block;
		margin-inline-start: 0.4rem;
		font-size: var(--gl-font-micro);
		font-weight: normal;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 0 100 auto;
		vertical-align: middle;
	}

	.compare-stats__additions {
		color: var(--gl-stat-added);
		margin-inline-end: 0.6rem;
	}

	.compare-stats__deletions {
		color: var(--gl-stat-removed);
	}

	/* Scoped file-pane header uses the SAME warning hue as the selected commit row + the graph
	   header's focus-branch scope chip — visual rhyme tells the user "this header is scoped to the
	   row that's highlighted above". The base gl-file-tree-pane.css strips border-top with
	   !important (intentional default for the unscoped case); we restore it here with !important
	   so the scoped header reads as its own banded region. */
	.compare-files--scoped gl-file-tree-pane::part(header) {
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
	   "No Autolinks Found" affordance reads identically across both panels. The inner
	   gl-chip-overflow stays single-row (its default); excess chips collapse into its "+N"
	   overflow affordance. */
	.compare-enrichment {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 1.2rem;
		font-size: var(--gl-font-sm);
		flex: none;
		min-width: 0;
	}

	.compare-enrichment gl-action-chip[data-action='autolink-settings'] {
		color: var(--color-foreground--65);
		--code-icon-size: 12px;
	}

	.compare-enrichment gl-action-chip::part(base) {
		gap: 0.4rem;
	}

	.compare-enrichment gl-action-chip::part(icon) {
		line-height: 1;
		display: inline-flex;
		align-items: center;
	}

	/* Files / Contributors view selector — slotted into the pane's title slot, so it must
	   visually sit inline with the title text it replaces (no margin/padding around the
	   popover; the trigger button supplies its own hit-target padding). The 0-padding
	   tooltip override removes the body inset so menu rows hug the popover edges. */
	/* The title-content slot wrapper itself needs to be shrinkable so its inner
	   popover/trigger/label can ellipse against the title slot's actual width. */
	span[slot='title-content'] {
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
		flex: 0 10 auto;
		overflow: hidden;
	}

	.compare-view-selector {
		display: inline-flex;
		--wa-tooltip-padding: 0;
		/* Allow the popover host (and trigger inside) to shrink within the title slot's
		   flex layout so the label ellipses instead of overflowing the row. */
		min-width: 0;
		max-width: 100%;
		flex: 0 10 auto;
	}

	.compare-view-trigger {
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
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
	}

	.compare-view-trigger:hover {
		background: var(--vscode-toolbar-hoverBackground);
	}

	.compare-view-trigger:focus-visible {
		background: var(--vscode-toolbar-hoverBackground);
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
	}

	.compare-view-trigger__label {
		text-transform: inherit;
		letter-spacing: inherit;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Reset inherited title styles inside the popover menu. text-transform/letter-spacing
	   are inheritable AND cross slot boundaries, so without this the menu items render in
	   the pane title's uppercase tracking. Also normalize weight + spacing for clean rows.
	   menu-list has a default padding-bottom: 0.6rem — zero it so rows hug the popover. */
	.compare-view-menu {
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

	.compare-view-menu menu-item {
		display: flex;
		align-items: center;
	}

	.compare-view-menu menu-item code-icon {
		margin-right: 0.6rem;
		opacity: 0.75;
	}

	/* Contributors list */
	.compare-contributors {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		flex: 1 1 auto;
		overflow-y: auto;
	}

	.compare-contributors--loading,
	.compare-contributors--empty,
	.compare-files--loading {
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		color: var(--vscode-descriptionForeground);
		padding: 2rem 1.2rem;
	}

	/* File-section loading container — sits in the gl-file-tree-pane "before-tree" slot in place
	   of the "No changes" empty text while the comparison is being recomputed. */
	.compare-files--loading {
		display: flex;
		text-align: center;
	}

	/* Per-side loading container — replaces the entire split-panel (commit list + files) when
	   the side's Phase 2 fetch hasn't returned yet. Centered fill so the user sees the panel
	   is working, not empty. */
	.compare-side-loading {
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
	   pseudo-row, replacing the "No autolinks found" affordance during a comparison change.
	   min-height matches gl-action-chip's intrinsic 2rem so the strip doesn't jump between
	   the spinner and the chip-based states. */
	.compare-enrichment__loading {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2rem;
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
	}

	/* Badge spinner — match the count text size so a "3"→spinner→"5" transition doesn't shift
	   tab widths. line-height:1 keeps the badge height locked. */
	.compare-tab__count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.compare-tab__count-spinner {
		--code-icon-size: var(--gl-font-micro);
		line-height: 1;
	}

	.compare-contributor {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.5rem 1.2rem;
		min-width: 0;
	}

	.compare-contributor:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.compare-contributor gl-avatar {
		flex: none;
		width: 24px;
		height: 24px;
	}

	.compare-contributor__info {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1 1 auto;
		gap: 0.1rem;
	}

	.compare-contributor__name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.compare-contributor__you {
		font-weight: 400;
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
		margin-left: 0.3rem;
	}

	.compare-contributor__stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		color: var(--vscode-descriptionForeground);
		font-size: 1.1rem;
	}

	.compare-contributor__diffstat {
		display: inline-flex;
		gap: 0.4rem;
	}

	.compare-contributor__additions {
		color: var(--vscode-gitDecoration-addedResourceForeground);
	}

	.compare-contributor__deletions {
		color: var(--vscode-gitDecoration-deletedResourceForeground);
	}
`;
