import { css } from 'lit';

export const titlebarStyles = css`
	.titlebar {
		/* Row geometry, as variables because the tint bands below are DERIVED from it (see
		   --titlebar-row-band-inset) and a hand-tuned inset would silently drift out of sync with it. */
		--titlebar-row-gap: 0.5rem;
		--titlebar-row-bleed: 0.5rem;
		/* Rows deliberately overlap: each box bleeds --titlebar-row-bleed past its content on both sides so
		   a tinted row reads as a band with breathing room, and the gap claws only part of that back —
		   leaving boxes overlapping by (2 × bleed − gap). Half of that per side is exactly the inset at
		   which neighbouring bands MEET without overlapping, which keeps two translucent tints from
		   compositing into a bright seam. */
		--titlebar-row-band-inset: calc(var(--titlebar-row-bleed) - var(--titlebar-row-gap) / 2);
		/* Opaque variant of --gl-chip-scoped-bg, mixed against this bar's own background instead of
		   transparent — needed where the tint must cover the gaps BETWEEN row bands as one solid
		   surface (see .titlebar--worktree-scoped below), which a translucent mix would let show
		   through. */
		--titlebar-scoped-bg-opaque: color-mix(
			in srgb,
			var(--gl-chip-scoped-color) var(--gl-chip-tint-bg),
			var(--titlebar-bg)
		);

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
		gap: var(--titlebar-row-gap);
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
		padding: var(--titlebar-row-bleed) 0.8rem;
		margin: calc(-1 * var(--titlebar-row-bleed)) -0.8rem;
		background-image: linear-gradient(
			to bottom,
			transparent 0 var(--titlebar-row-band-inset),
			var(--titlebar-row-band-edge, transparent) var(--titlebar-row-band-inset)
				calc(var(--titlebar-row-band-inset) + var(--gl-border-width)),
			var(--titlebar-row-band-bg, transparent) calc(var(--titlebar-row-band-inset) + var(--gl-border-width))
				calc(100% - var(--titlebar-row-band-inset) - var(--gl-border-width)),
			var(--titlebar-row-band-edge, transparent)
				calc(100% - var(--titlebar-row-band-inset) - var(--gl-border-width))
				calc(100% - var(--titlebar-row-band-inset)),
			transparent calc(100% - var(--titlebar-row-band-inset)) 100%
		);
		/* Every row's tint is a GRADIENT BAND rather than a plain background, bounded to the row's own share
		   of the overlapping box, so adjacent bands abut exactly and any pair of tints meets in a clean
		   edge instead of compositing into a brighter one. Both tokens default to transparent, so an
		   untinted row paints nothing. Deliberately not a positioned pseudo-element: that needs a stacking
		   context on the row, which the header's popovers escape by design. The border-box origin makes
		   0%/100% span the border box, matching the geometry the margins overlap on. */
		background-origin: border-box;
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
		--titlebar-row-band-bg: color-mix(in srgb, var(--gl-chip-filtered-color) var(--gl-chip-tint-bg), transparent);
		--titlebar-row-band-edge: color-mix(
			in srgb,
			var(--gl-chip-filtered-color) var(--gl-chip-tint-border),
			transparent
		);
	}

	.titlebar__row--scoped {
		--titlebar-row-band-bg: var(--gl-chip-scoped-bg);
		--titlebar-row-band-edge: var(--gl-chip-scoped-border);
	}

	/* Plain branch scope tints only the search row; worktree scope marks the whole bar. The whole-bar state
	   paints the CONTAINER as one opaque surface rather than tinting each row, because it must cover the
	   gaps BETWEEN the bands too. The search row's own band is suppressed so its edges don't draw a seam
	   across that surface, and the bottom edge is an inset shadow, not a border, to avoid a layout shift on
	   toggle. */
	.titlebar--worktree-scoped {
		background: var(--titlebar-scoped-bg-opaque);
		box-shadow: inset 0 calc(-1 * var(--gl-border-width)) 0 var(--gl-chip-scoped-border);
	}

	.titlebar--worktree-scoped .titlebar__row--scoped {
		--titlebar-row-band-bg: transparent;
		--titlebar-row-band-edge: transparent;
	}

	/* Scope WITHOUT a focus: tint only the top (identity) row, so unfocusing a scoped graph visibly
	   releases the search row while the scope stays marked. Rides the same bounded band as every other row
	   tint; the opaque mix keeps the color identical to the whole-bar state above. */
	.titlebar--worktree-scoped-only .titlebar__row--wrap {
		--titlebar-row-band-bg: var(--titlebar-scoped-bg-opaque);
		--titlebar-row-band-edge: var(--gl-chip-scoped-border);
	}

	/* The ◎ focus toggle, pilled while the current branch IS focused — the same chip recipe as the
	   scope pill and the mode chip, so every "this state is active" affordance shares one colorization.
	   --button-foreground works here because this selector matches the gl-button ELEMENT itself, which
	   outranks the toolbar-appearance :host rule that defines the same property inside its shadow DOM.
	   Setting it on an ANCESTOR would not (see the scoped pill's ::part rule above). */
	gl-button.jump-to-ref--active {
		--button-foreground: var(--gl-chip-scoped-text-color);

		background: var(--gl-chip-scoped-bg);
		border-radius: var(--gl-radius-sm);
		box-shadow: inset 0 0 0 var(--gl-border-width) var(--gl-chip-scoped-border);
	}

	/* Wraps the branch pill and (when worktree-scoped) its unscope clear button as one visual unit — always
	   present, so toggling scope changes only the modifier class and the clear button, never the DOM shape.
	   Deliberately not a <span>: the :nth-child(1) > span selector above pins flex-shrink to 0, which would
	   stop the branch pill shrinking on narrow rows. */
	.ref-button-group {
		display: flex;
		flex-shrink: 1;
		align-items: stretch;
		min-width: 0;
		/* Colored (not added) by the worktree-scoped modifier below, so toggling never shifts layout. */
		border: var(--gl-border-width) solid transparent;
		border-radius: var(--gl-radius-sm);
	}

	.ref-button-group__ref {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* Worktree-scope highlight on the branch pill unit — the EXACT recipe of the scope chip's scoped state
	   (mode-chip--scoped), so the two treatments read as one colorization. The plain color property here
	   covers the light-DOM unscope button, which inherits it. */
	.ref-button-group--worktree-scoped {
		padding-right: 0.2rem;
		color: var(--gl-chip-scoped-text-color);
		background: var(--gl-chip-scoped-bg);
		border-color: var(--gl-chip-scoped-border);
	}

	/* The branch NAME lives in gl-ref-button's shadow DOM, and gl-button's toolbar-appearance :host rule
	   DEFINES --button-foreground on itself — a local definition beats an inherited one, so setting the
	   property on this wrapper (or on gl-ref-button) never reaches the text. ::part() targets that inner
	   gl-button from the outer tree, which does win, and its control inherits the color onward to the
	   slotted ref name and the chevron. */
	.ref-button-group--worktree-scoped gl-ref-button::part(button) {
		--button-foreground: var(--gl-chip-scoped-text-color);
	}

	/* Full-bleed banner across the top of the scoped pill's tooltip. Bleeds past the tooltip body's padding
	   (--wa-tooltip-padding is a two-value shorthand, so its halves are named here rather than calc'd) and
	   rounds its own top corners — the popup doesn't clip. Text is the page background: the chip color is
	   picked to read against it, so the inverse holds too. */
	.scope-banner {
		display: flex;
		gap: var(--gl-space-6);
		align-items: flex-start;
		margin: calc(-1 * var(--wa-spacing-2x-small)) calc(-1 * var(--wa-spacing-x-small)) var(--gl-space-8);
		padding: var(--gl-space-6) var(--wa-spacing-x-small);
		color: var(--color-background);
		background: var(--gl-chip-scoped-color);
		border-radius: var(--wa-tooltip-border-radius) var(--wa-tooltip-border-radius) 0 0;
	}

	.scope-banner code-icon {
		flex: none;
		margin-block-start: 0.2rem;
	}

	.scope-banner__text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.scope-banner__label {
		font-size: 1.1rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		opacity: 0.85;
	}

	.scope-banner__name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.scope-path {
		display: flex;
		gap: var(--gl-space-4);
		align-items: flex-start;
		margin-block-start: var(--gl-space-4);
		font-family: var(--vscode-editor-font-family);
		font-size: 1.05rem;
		line-height: 1.4;
		opacity: 0.7;
		overflow-wrap: anywhere;
	}

	.scope-path code-icon {
		flex: none;
		font-size: 1.2rem;
		margin-block-start: 0.1rem;
	}

	.ref-button-group__clear-tooltip {
		display: inline-flex;
		flex: none;
		align-items: center;
	}

	.ref-button-group__clear {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		color: inherit;
		cursor: pointer;
		background: none;
		border: none;
		border-radius: var(--gl-radius-xs);
		opacity: 0.75;
	}

	.ref-button-group__clear:hover,
	.ref-button-group__clear:focus-visible {
		background: var(--gl-chip-scoped-hover);
		opacity: 1;
	}

	.ref-button-group__clear:focus-visible {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: -1px;
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

	/* Details split toggle: main half toggles show/hide, chevron half opens the placement popover.
	   No chrome until hover, matching the other toolbar buttons around it. */
	.split-toolbar {
		display: inline-flex;
		align-items: stretch;
		border-radius: 0.5rem;
	}

	.split-toolbar:hover {
		background: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 45%, transparent);
	}

	.split-toolbar__main {
		border-start-end-radius: 0;
		border-end-end-radius: 0;
	}

	/* The popover wrapper sits between the container and the chevron — stretch through it so both
	   halves share one height. */
	.split-toolbar__popover {
		display: inline-flex;
		align-items: stretch;
	}

	.split-toolbar__chevron {
		/* gl-popover wraps its anchor slot in a plain div inside its shadow DOM, which breaks the
		   align-items:stretch chain — so the chevron's smaller glyph leaves it shorter than the main
		   half. min-height mirrors the main half's metrics (1.6rem icon + 2x padding + 2x border);
		   height:100% still helps when the stretch chain does work. */
		height: 100%;
		min-height: calc(1.6rem + 2 * 0.4rem + 2 * var(--gl-border-width));
		border-left: 0.1rem solid transparent;
		border-start-start-radius: 0;
		border-end-start-radius: 0;
		--button-padding: 0.4rem 0.1rem;
	}

	/* Same micro chevron as the other header split/menu buttons (action-button__more). */
	.split-toolbar__chevron code-icon {
		--code-icon-size: var(--gl-font-micro);
	}

	.split-toolbar:hover .split-toolbar__chevron {
		border-left-color: color-mix(in srgb, var(--vscode-foreground) 25%, transparent);
	}

	/* gl-button's default focus ring sits 2px OUTSIDE the host — on the narrow chevron half that
	   overlaps the main half and the neighboring button. Draw both halves' rings inset instead, so
	   each ring hugs its own half (squared on the seam, rounded on the outside). */
	.split-toolbar__main:focus-within,
	.split-toolbar__chevron:focus-within {
		outline-offset: -0.1rem;
	}

	.details-placement {
		display: flex;
		gap: 0.4rem;
	}

	.details-placement__option {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: center;
		padding: 0.4rem;
		font-family: inherit;
		font-size: 1.05rem;
		color: inherit;
		cursor: pointer;
		background: none;
		border: 0.1rem solid transparent;
		border-radius: 0.5rem;
	}

	.details-placement__option:hover {
		background: var(--vscode-toolbar-hoverBackground);
	}

	.details-placement__option:focus-visible {
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
	}

	.details-placement__option[aria-checked='true'] {
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
		border-color: var(--vscode-focusBorder);
	}

	.details-placement__option svg {
		display: block;
		width: 3.6rem;
		height: auto;
	}
`;
