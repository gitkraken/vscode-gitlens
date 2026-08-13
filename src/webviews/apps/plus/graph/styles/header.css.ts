import { css } from 'lit';

export const titlebarStyles = css`
	.titlebar {
		flex-wrap: wrap;
		padding: 0 0.4rem 0.5rem;
		font-size: var(--gl-font-base);
		color: var(--titlebar-fg);
		background: var(--titlebar-bg);
	}

	:host-context(body[data-placement='panel']) .titlebar {
		border-color: var(--vscode-sideBarSectionHeader-border, transparent);
		border-top: var(--gl-border-width) solid transparent;
	}

	.titlebar,
	.titlebar__row,
	.titlebar__group {
		display: flex;
		flex-direction: row;
		gap: 0.5rem;
		align-items: center;
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
		padding: 0.5rem 0.8rem;
		margin: -0.5rem -0.8rem;
		border-top: var(--gl-border-width) solid transparent;
		border-bottom: var(--gl-border-width) solid transparent;
	}

	.titlebar__row--promo {
		justify-content: center;
		container-name: graph-titlebar-promo;
		container-type: inline-size;
		overflow: hidden;
	}

	.titlebar__row--promo:not(:has(gl-graph-header-promo[has-promo])) {
		display: none;
	}

	/* The "too narrow" state must hide the ROW (its borders and the titlebar's row-gap included), and a
	   container can't gate its own display — so this is a media query. The strip always spans the full
	   webview width, so the viewport tracks the strip's width to within the header padding. */
	@media (width <= 250px) {
		.titlebar__row--promo {
			display: none;
		}
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
		gap: 0.5rem;
		align-items: center;
		justify-content: flex-start;
		min-width: 0;
		container-name: graph-titlebar;

		/* Container so descendants (e.g. gl-fetch-button's text) can use container
		   queries against the row's inline size for stepwise label collapsing. */
		container-type: inline-size;
		overflow: hidden;
	}

	.titlebar__group {
		flex: 1 1 auto;
	}

	.titlebar__row--wrap .titlebar__group {
		flex: 0 1 auto;

		/* min-width: 0 lets each group shrink past its intrinsic content
		   min-width — without this, groups stay at content size and items
		   overflow horizontally instead of ellipsing. */
		min-width: 0;
		white-space: nowrap;
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
`;

export const graphHeaderControlStyles = css`
	.titlebar__group gl-repo-button-group,
	.titlebar__group gl-ref-button {
		font-size: var(--gl-font-md);
	}

	/* The repo group trims these icon buttons to a 0.2rem pad to keep its trailing edge tight, which
	   also leaves them shorter than every other header control. Restore only the vertical pad so they
	   match the ~2.6rem row height, keeping the tight horizontal pad the component intends. */
	.titlebar__group gl-repo-button-group::part(provider-icon),
	.titlebar__group gl-repo-button-group::part(connect-icon) {
		--button-padding: 0.3rem 0.2rem;
	}

	.shrink {
		max-width: fit-content;
		transition: all var(--gl-duration-medium);
	}

	.shrink.hidden {
		max-width: 0;
		overflow: hidden;
	}

	.titlebar__group .shrink.hidden:not(:first-child) {
		/* compensate the parent gap */
		margin-left: -0.5rem;
	}

	/* Rows in the hidden-refs popover. The outer tree wins over menu-item's own :host { display: block },
	   so laying the row out from here is what gives the icon, label and restore glyph their alignment. */
	.hidden-ref {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
	}

	.hidden-ref__label {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The owner prefix that disambiguates same-named branches across remotes, and the qualifier on a
	   remote-wide hide. Both stay subordinate to the ref name — including against the selection fill,
	   where descriptionForeground has no contrast left. */
	.hidden-ref__owner,
	.hidden-ref__suffix {
		color: var(--vscode-descriptionForeground);
	}

	.hidden-ref:hover .hidden-ref__owner,
	.hidden-ref:hover .hidden-ref__suffix,
	.hidden-ref:focus-visible .hidden-ref__owner,
	.hidden-ref:focus-visible .hidden-ref__suffix {
		color: color-mix(in srgb, var(--vscode-menu-selectionForeground) 78%, transparent);
	}

	/* Clicking the row restores the ref; this is the only thing that says so. */
	.hidden-ref__show {
		flex: none;
		opacity: 0;
		transition: opacity var(--gl-duration-x-fast) var(--gl-ease-out);
	}

	.hidden-ref:hover .hidden-ref__show,
	.hidden-ref:focus-visible .hidden-ref__show {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.hidden-ref__show {
			transition: none;
		}
	}

	.hidden-ref__icon {
		flex: none;
	}

	.action-divider {
		display: inline-block;
		width: 0.1rem;
		height: 2.2rem;
		/* margin-left: 0.2rem; */
		margin-right: 0.2rem;
		vertical-align: middle;
		background-color: var(--titlebar-fg);
		opacity: 0.4;
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
		padding: var(--gl-space-2) var(--gl-space-4);
	}

	wa-option:focus::part(base) {
		color: var(--vscode-list-activeSelectionForeground);
		background-color: var(--vscode-list-activeSelectionBackground);
	}

	wa-option:not(:focus):hover::part(base) {
		color: var(--vscode-list-activeSelectionForeground);
		background-color: var(--vscode-list-inactiveSelectionBackground);
	}

	wa-option::part(checked-icon) {
		display: none;
	}

	wa-select::part(listbox) {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		width: max-content;
		padding-block: var(--gl-space-2) 0;
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
