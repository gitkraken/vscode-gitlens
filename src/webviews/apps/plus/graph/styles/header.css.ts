import { css } from 'lit';

export const titlebarStyles = css`
	.titlebar {
		background: var(--titlebar-bg);
		color: var(--titlebar-fg);
		padding: 0.5rem 0.8rem;
		font-size: 1.3rem;
		flex-wrap: wrap;
	}

	:host-context(body[data-placement='panel']) .titlebar {
		border-top: 1px solid transparent;
		border-color: var(--vscode-sideBarSectionHeader-border, transparent);
	}
	.titlebar,
	.titlebar__row,
	.titlebar__group {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.titlebar > *,
	.titlebar__row > *,
	.titlebar__group > * {
		margin: 0;
	}

	.titlebar,
	.titlebar__row {
		justify-content: space-between;
	}

	.titlebar__row {
		flex: 0 0 100%;
		border-top: 1px solid transparent;
		border-bottom: 1px solid transparent;
		margin: -0.5rem -0.8rem;
		padding: 0.5rem 0.8rem;
	}

	.titlebar__row--filtered {
		background: color-mix(in srgb, var(--gl-chip-filtered-color) var(--gl-chip-tint-bg), transparent);
		border-top-color: color-mix(in srgb, var(--gl-chip-filtered-color) var(--gl-chip-tint-border), transparent);
		border-bottom-color: color-mix(in srgb, var(--gl-chip-filtered-color) var(--gl-chip-tint-hover), transparent);
	}

	.titlebar__row--scoped {
		background: color-mix(in srgb, var(--gl-chip-scoped-color) var(--gl-chip-tint-bg), transparent);
		border-top-color: color-mix(in srgb, var(--gl-chip-scoped-color) var(--gl-chip-tint-border), transparent);
		border-bottom-color: color-mix(in srgb, var(--gl-chip-scoped-color) var(--gl-chip-tint-hover), transparent);
	}

	.titlebar__row--wrap {
		/* Three flex groups: LEFT, CENTER (grows to fill, centered content),
		   RIGHT. Using flex-start + flex-grow on CENTER instead of
		   space-between because space-between anchors RIGHT to the row's right
		   edge — when LEFT + RIGHT exceed the row width, RIGHT would overlap
		   LEFT instead of extending past the right edge. With this layout,
		   when content overflows CENTER shrinks first (flex-shrink 100), then
		   LEFT (flex-shrink 10), and finally RIGHT (flex-shrink 0) gets pushed
		   past the right edge and clipped by overflow:hidden — staying in the
		   DOM so it reappears as the row widens again. */
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: flex-start;
		min-width: 0;
		overflow: hidden;
		/* Container so descendants (e.g. gl-fetch-button's text) can use container
		   queries against the row's inline size for stepwise label collapsing. */
		container-type: inline-size;
		container-name: graph-titlebar;
	}

	.titlebar__group {
		flex: 1 1 auto;
	}

	.titlebar__row--wrap .titlebar__group {
		flex: 0 1 auto;
		white-space: nowrap;
		/* min-width: 0 lets each group shrink past its intrinsic content
		   min-width — without this, groups stay at content size and items
		   overflow horizontally instead of ellipsing. */
		min-width: 0;
	}

	/* Search row uses one group; set per-child shrink priorities so the
	   search box yields width first, then the scope chip, while dividers
	   and the button-group stay pinned. */
	.titlebar__row--search .titlebar__group {
		min-width: 0;
	}
	.titlebar__row--search .titlebar__group > gl-graph-scope-popover {
		flex: 0 1 auto;
		min-width: 0;
	}
	.titlebar__row--search .titlebar__group > gl-search-box {
		flex-shrink: 100;
	}
	.titlebar__row--search .titlebar__group > .button-group,
	.titlebar__row--search .titlebar__group > span {
		flex: none;
	}
	.titlebar__row--wrap .titlebar__group:nth-child(1) {
		flex-shrink: 10;
		min-width: min-content;
	}
	.titlebar__row--wrap .titlebar__group:nth-child(1) > * {
		flex-shrink: 1;
	}
	/* Repo yields width before the branch. Keep this much higher than the
		   sibling shrink factor so the branch doesn't lose even a few pixels
		   before the repo reaches its compact floor. */
	.titlebar__row--wrap .titlebar__group:nth-child(1) > gl-repo-button-group {
		flex-shrink: 1000000;
	}
	.titlebar__row--wrap .titlebar__group:nth-child(1) > span,
	.titlebar__row--wrap .titlebar__group:nth-child(1) > .jump-to-ref,
	.titlebar__row--wrap .titlebar__group:nth-child(1) > gl-popover {
		flex-shrink: 0;
	}
	.titlebar__row--wrap .titlebar__group:nth-child(2) {
		flex: 1 100 auto;
		/* Grow to fill so RIGHT sits at the row's right edge naturally without
		   space-between. justify-content: center centers CENTER's own content
		   (the fetch button) within the grown box so there's visual space on
		   both sides — matching what space-between previously gave us at wide
		   widths. */
		justify-content: center;
		/* Floor CENTER at its content's min-content. Without this, the generic
		   .titlebar__group { min-width: 0 } rule above lets CENTER's box
		   collapse to 0 under flex-shrink: 100. When that happens, its non-
		   shrinkable inner buttons (gl-fetch-button, sync gl-button — all
		   projected via display:contents from gl-git-actions-buttons) overflow
		   the 0-width box and visually overlap RIGHT, which is sitting flush
		   against the collapsed box. Flooring CENTER at min-content keeps the
		   buttons inside (while still allowing them to shrink down to their
		   icon-only states), so further shrinkage of the row pushes RIGHT past
		   the row's right edge (clipped by the row's overflow: hidden) instead. */
		min-width: min-content;
	}
	.titlebar__row--wrap .titlebar__group:nth-child(3) {
		flex-shrink: 0;
	}

	.titlebar__debugging > * {
		display: inline-block;
	}

	.titlebar gl-feature-badge {
		color: var(--color-foreground);
	}
`;

export const graphHeaderControlStyles = css`
	.popover::part(body) {
		padding: 0;
		font-size: var(--vscode-font-size);
		background-color: var(--vscode-menu-background);
	}

	.titlebar__group gl-repo-button-group,
	.titlebar__group gl-ref-button {
		font-size: 1.2rem;
	}

	.shrink {
		max-width: fit-content;
		transition: all 0.2s;
	}
	.shrink.hidden {
		max-width: 0;
		overflow: hidden;
	}
	.titlebar__group .shrink.hidden:not(:first-child) {
		// compensate the parent gap
		margin-left: -0.5rem;
	}

	.branch-menu {
		display: flex;
		gap: 0.5em;
		align-items: center;
	}

	.branch-menu__avatar {
		width: 1.4rem;
		aspect-ratio: 1;
		vertical-align: text-bottom;
	}

	.action-divider {
		display: inline-block;
		width: 0.1rem;
		height: 2.2rem;
		vertical-align: middle;
		background-color: var(--titlebar-fg);
		opacity: 0.4;
		margin: {
			// left: 0.2rem;
			right: 0.2rem;
		}
	}

	.button-group {
		display: flex;
		flex-direction: row;
		align-items: stretch;
	}

	gl-search-box::part(search) {
		--gl-search-input-background: var(--color-graph-actionbar-background);
		--gl-search-input-border: var(--wa-input-border-color);
	}

	wa-option::part(base) {
		padding: 0.2rem 0.4rem;
	}

	wa-option:focus::part(base) {
		background-color: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}

	wa-option:not(:focus):hover::part(base) {
		background-color: var(--vscode-list-inactiveSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}

	wa-option::part(checked-icon) {
		display: none;
	}

	wa-select::part(listbox) {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding-block: 0.2rem 0;
		width: max-content;
	}

	wa-select::part(combobox) {
		--wa-input-background-color: var(--color-graph-actionbar-background);
		--wa-input-color: var(--color-foreground);
		--wa-input-color-hover: var(--color-foreground);
		padding: 0 0.75rem;
		color: var(--color-foreground);
		border-radius: var(--wa-border-radius-small);
	}

	wa-select::part(display-input) {
		field-sizing: content;
	}

	wa-select::part(expand-icon) {
		margin-inline-start: var(--wa-spacing-x-small);
	}

	wa-select[open]::part(combobox) {
		background-color: var(--color-graph-actionbar-background);
	}
	wa-select:hover::part(combobox),
	wa-select:focus::part(combobox) {
		background-color: var(--color-graph-actionbar-selectedBackground);
	}
`;
