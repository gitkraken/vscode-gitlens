import { css, unsafeCSS } from 'lit';

/* State colors: uncommitted=amber, unpushed=tracking-ahead teal, pushed=muted */
const uncommittedColor = unsafeCSS('var(--vscode-gitlens-decorations-worktreeUncommittedForeground, #e2c08d)');
const unpushedColor = unsafeCSS('var(--gl-tracking-ahead, #4ec9b0)');
const pushedColor = unsafeCSS('var(--color-foreground--75)');
const mergeBaseColor = unsafeCSS('var(--color-foreground--50)');
const connectorPushedColor = unsafeCSS('color-mix(in srgb, var(--color-foreground, #888) 25%, transparent)');
const bgColor = unsafeCSS('var(--vscode-sideBar-background, var(--color-background, #1e1e1e))');

export const commitsScopePaneStyles = css`
	:host {
		--details-scope-pane-uncommitted-color: ${uncommittedColor};
		--details-scope-pane-unpushed-color: ${unpushedColor};
		--details-scope-pane-pushed-color: ${pushedColor};
		--details-scope-pane-merge-base-color: ${mergeBaseColor};
		--details-scope-pane-connector-pushed-color: ${connectorPushedColor};
		--details-scope-pane-bg-color: ${bgColor};

		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.details-scope-pane {
		flex: 1;
		min-height: 0;

		/* Without an explicit overflow-x, the spec collapses overflow-x:visible to auto
		   whenever overflow-y is anything other than visible — so when the vertical scrollbar
		   appears and shrinks the inline-axis room, any row that's a few pixels over (long
		   label, wide stats badge) suddenly triggers a horizontal scrollbar too. overflow-x:
		   clip suppresses that without spawning a scroll container the way hidden does. */
		overflow: clip auto;
	}

	.details-scope-pane--dragging {
		user-select: none;
	}

	/* Scope rows — no vertical padding so connectors can span the full row height seamlessly */
	.scope-row {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		min-height: 2.4rem;
		padding: 0 var(--gl-space-10) 0 var(--gl-space-12);
		font-size: var(--gl-font-base);
		transition: opacity var(--gl-duration-fast) ease;
	}

	.scope-row--included {
		background: var(--vscode-list-inactiveSelectionBackground, rgb(86 156 214 / 6%));
	}

	/* Click-to-set-edge: clicking a row snaps the nearer range edge to it. The
	   pointer cue tells users the row is interactive; the hover wash mirrors how
	   VS Code list rows highlight on hover. Suppress hover wash while a drag is
	   in progress so the row under the cursor doesn't double-highlight. */
	.scope-row--clickable {
		cursor: pointer;
	}

	.details-scope-pane:not(.details-scope-pane--dragging) .scope-row--clickable:hover {
		background: var(--vscode-list-hoverBackground);
	}

	/* The end-edge row is the Tab stop, but the focus *indicator* belongs on the
	   adjacent end-handle bar — a tight ring on the bar is the natural visual
	   anchor for "this is the active edge," rather than bracketing the whole row.
	   Suppress the row's own outline; the actual ring is drawn further down on
	   .scope-handle__bar via a sibling selector. */
	.scope-row:focus,
	.scope-row:focus-visible {
		outline: none;
	}

	/* Dim row content (including the connector segments inside this row's
	   dot-col, so the line fades with its dots) WITHOUT dimming tooltip
	   hosts — opacity on a gl-tooltip / formatted-date / gl-avatar carries
	   through to their hoisted popups. So skip those hosts at the outer
	   level and dim their visible parts directly: label-text inside the
	   tooltip, formatted-date's 'base' part, gl-avatar's 'avatar' part. */
	.scope-row--excluded > *:not(.scope-row__dot-col, gl-tooltip, formatted-date, gl-avatar),
	.scope-row--excluded .scope-row__label-text,
	.scope-row--excluded formatted-date::part(base),
	.scope-row--excluded gl-avatar::part(avatar),
	.scope-row--excluded .scope-row__dot-col > * {
		opacity: 0.4;
	}

	.scope-row--loading > *:not(.scope-row__dot-col, gl-tooltip, formatted-date, gl-avatar),
	.scope-row--loading .scope-row__label-text,
	.scope-row--loading formatted-date::part(base),
	.scope-row--loading gl-avatar::part(avatar),
	.scope-row--loading .scope-row__dot-col > * {
		opacity: 0.6;
	}

	.scope-row__label--dimmed {
		font-style: italic;
		color: var(--vscode-descriptionForeground);
	}

	.scope-row__dot-col {
		position: relative;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		align-self: stretch;
		justify-content: center;
		width: 14px;
	}

	/* Connector lines — span the dot-col with square ends so they don't render
	   a visible rounded cap near the dot edge. Default (pushed/merge-base)
	   is a desaturated grey so visual emphasis stays on the in-scope chain. */
	.scope-row__connector {
		position: absolute;
		left: 50%;
		width: 2px;
		background: var(--details-scope-pane-connector-pushed-color);
		transform: translateX(-50%);
	}

	/* The full gap between two dots takes the UPPER commit's color: the row's
	   own --below uses its state, and the row's --above uses the previous
	   row's state. Both segments meet across the row boundary in one color. */
	.scope-row[data-state='uncommitted'] .scope-row__connector--below {
		background: var(--details-scope-pane-uncommitted-color);
	}

	.scope-row[data-state='unpushed'] .scope-row__connector--below {
		background: var(--details-scope-pane-unpushed-color);
	}

	.scope-row[data-prev-state='uncommitted'] .scope-row__connector--above {
		background: var(--details-scope-pane-uncommitted-color);
	}

	.scope-row[data-prev-state='unpushed'] .scope-row__connector--above {
		background: var(--details-scope-pane-unpushed-color);
	}

	/* Connectors stop short of the dot edge (dot radius 0.6rem + 2px gap) so
	   the line reads as joining dots rather than running through them. */
	.scope-row__connector--above {
		top: 0;
		bottom: calc(50% + 0.6rem + 2px);
	}

	.scope-row__connector--below {
		top: calc(50% + 0.6rem + 2px);
		bottom: 0;
	}

	.scope-row__label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* When the label is wrapped in <gl-tooltip class="scope-row__label">, the
	   inner <span class="scope-row__label-text"> holds the actual text and
	   needs its own truncation rules. */
	.scope-row__label-text {
		display: block;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scope-row__date {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.scope-row__avatar {
		--gl-avatar-size: 2.2rem;

		flex-shrink: 0;
	}

	/* BASE badge on the merge-base row, in place of the date column.
	   Styled to match the compose post-result base tag visual. */
	.scope-row__base-tag {
		flex-shrink: 0;
		padding: 0.1rem 0.4rem;
		margin-left: auto;
		font-size: var(--gl-font-micro);
		font-style: normal;
		color: var(--vscode-descriptionForeground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
		border-radius: var(--gl-radius-sm);
	}

	.scope-row__stats {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
	}

	/* Drag handle — sits between rows */
	.scope-handle {
		position: relative;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.3rem 0;
		touch-action: none;
		cursor: ns-resize;
	}

	/* Connector line through the drag handle gap — colored by the UPPER row's
	   state via data-state, mirroring the row connector rule. */
	.scope-handle::before {
		position: absolute;
		top: 0;
		bottom: -2px;
		left: calc(1.2rem + 7px);
		width: 2px;
		content: '';
		background: var(--details-scope-pane-connector-pushed-color);
		transform: translateX(-50%);
	}

	.scope-handle[data-state='uncommitted']::before {
		background: var(--details-scope-pane-uncommitted-color);
	}

	.scope-handle[data-state='unpushed']::before {
		background: var(--details-scope-pane-unpushed-color);
	}

	.scope-handle__bar {
		position: relative;
		width: 5rem;
		height: 0.5rem;
		background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
		border-radius: var(--gl-radius-xs);
		opacity: 0.7;
		transition: opacity var(--gl-duration-fast) ease;
	}

	.scope-handle:hover .scope-handle__bar,
	.scope-handle:focus-visible .scope-handle__bar,
	.scope-row:focus-visible + .scope-handle .scope-handle__bar,
	.scope-handle--active .scope-handle__bar {
		opacity: 0.85;
	}

	/* Suppress the browser default outline on the handle itself — the wider hit
	   area shouldn't take the focus indicator. The ring lives on the bar (below). */
	.scope-handle:focus,
	.scope-handle:focus-visible {
		outline: none;
	}

	/* Focus ring lives on the handle bar — a small ring around the visible
	   interactive element rather than a rectangle around the whole row. Two
	   focus paths land here:
	   - Start handle (review-mode Tab stop) — its own :focus-visible.
	   - End handle (no Tab stop) — adjacent end-edge row has focus; the
	     sibling selector hops the indicator onto the trailing handle bar. */
	.scope-handle:focus-visible .scope-handle__bar,
	.scope-row:focus-visible + .scope-handle .scope-handle__bar {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: 2px;
	}

	/* Proxy handle: pinned to the top/bottom edge of the scroll container when
	   the corresponding real handle is offscreen. Pressing it snaps the scroll
	   so the real handle lands under the cursor and the drag continues. */
	.scope-handle--proxy {
		position: sticky;
		z-index: 3;
		padding: var(--gl-space-4) 0;
		pointer-events: auto;
	}

	.scope-handle--proxy::before {
		content: none;
	}

	.scope-handle--proxy-start {
		top: 0;
		background: linear-gradient(
			to bottom,
			var(--details-scope-pane-bg-color) 0%,
			var(--details-scope-pane-bg-color) 60%,
			transparent 100%
		);
	}

	.scope-handle--proxy-end {
		bottom: 0;
		background: linear-gradient(
			to top,
			var(--details-scope-pane-bg-color) 0%,
			var(--details-scope-pane-bg-color) 60%,
			transparent 100%
		);
	}

	.scope-handle--proxy .scope-handle__bar {
		opacity: 0.85;
	}

	.scope-handle--proxy:hover .scope-handle__bar {
		opacity: 1;
	}

	.scope-handle--proxy code-icon {
		position: absolute;
		font-size: var(--gl-font-micro);
		color: var(--vscode-descriptionForeground);
		pointer-events: none;
	}

	/*
	 * Dot state indicators
	 * All dots render at the same outer diameter (12px) using box-sizing: border-box
	 * so border-based dots don't grow larger than filled ones. Sized to read as
	 * deliberate timeline markers rather than incidental punctuation.
	 */
	.dot-uncommitted,
	.dot-unpushed,
	.dot-pushed,
	.dot-merge-base {
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		flex-shrink: 0;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
	}

	/* Uncommitted: hollow ring in amber to read as the WIP/in-flight marker. */
	.scope-row[data-state='uncommitted'] .dot-uncommitted {
		background: var(--details-scope-pane-bg-color);
		border: 2px dotted var(--details-scope-pane-uncommitted-color);
	}

	/* Unpushed: filled in tracking-ahead teal — matches ahead-tracking pills. */
	.scope-row[data-state='unpushed'] .dot-unpushed {
		background: var(--details-scope-pane-bg-color);
		border: 3px solid var(--details-scope-pane-unpushed-color);
	}

	/* Pushed: muted filled circle — pushed commits are context, not focus. */
	.scope-row[data-state='pushed'] .dot-pushed {
		background: var(--details-scope-pane-pushed-color);
	}

	/* Merge base: open ring in a quieter foreground tone — reads as a
	   boundary marker, not another commit dot. */
	.scope-row[data-state='merge-base'] .dot-merge-base {
		background: var(--details-scope-pane-merge-base-color);
	}

	/* Merge base row — matches the --excluded/--loading pattern so any
	   tooltip-hosting children (commit-stats, etc.) keep their popups at
	   full opacity while the row's visible content (and connector into
	   the base) dims uniformly. */
	.scope-row--merge-base {
		font-style: italic;
	}

	.scope-row--merge-base > *:not(.scope-row__dot-col, gl-tooltip, formatted-date, gl-avatar),
	.scope-row--merge-base .scope-row__label-text,
	.scope-row--merge-base formatted-date::part(base),
	.scope-row--merge-base gl-avatar::part(avatar),
	.scope-row--merge-base .scope-row__dot-col > * {
		opacity: 0.5;
	}

	/* Load-more row: a button styled like a row that lets users extend the loaded
	   commit window back toward the merge base on demand. */
	.scope-row--load-more {
		width: 100%;
		font: inherit;
		color: inherit;
		text-align: left;
		appearance: none;
		cursor: pointer;
		background: transparent;
		border: none;
	}

	.scope-row--load-more:hover:not(:disabled) {
		background: var(--vscode-list-hoverBackground);
	}

	.scope-row--load-more:disabled {
		cursor: default;
		opacity: 0.7;
	}

	.scope-row--load-more code-icon {
		color: var(--vscode-descriptionForeground);
	}
`;
