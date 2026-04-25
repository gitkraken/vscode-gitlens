import { css, unsafeCSS } from 'lit';

/* State colors: uncommitted=yellow, unpushed=green, pushed=grey */
const uncommittedColor = unsafeCSS('var(--vscode-gitlens-decorations-worktreeUncommittedForeground, #e2c08d)');
const unpushedColor = unsafeCSS('var(--vscode-gitlens-decorations-addedForeground, #73c991)');
const pushedColor = unsafeCSS('var(--vscode-descriptionForeground, #888)');
const bgColor = unsafeCSS('var(--vscode-sideBar-background, var(--color-background, #1e1e1e))');

export const detailsScopePaneStyles = css`
	:host {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.details-scope-pane {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.details-scope-pane--dragging {
		user-select: none;
	}

	/* Scope rows — no vertical padding so connectors can span the full row height seamlessly */
	.scope-row {
		display: flex;
		align-items: center;
		min-height: 2.4rem;
		padding: 0 1rem 0 1.2rem;
		gap: 0.6rem;
		font-size: var(--gl-font-base);
		transition: opacity 0.15s ease;
	}

	.scope-row--included {
		background: var(--vscode-list-inactiveSelectionBackground, rgba(86, 156, 214, 0.06));
	}

	/* Dim row content (including the connector segments inside this row's
	   dot-col, so the line fades with its dots) WITHOUT dimming tooltip
	   hosts — opacity on a gl-tooltip / formatted-date / gl-avatar carries
	   through to their hoisted popups. So skip those hosts at the outer
	   level and dim their visible parts directly: label-text inside the
	   tooltip, formatted-date's 'base' part, gl-avatar's 'avatar' part. */
	.scope-row--excluded > *:not(.scope-row__dot-col):not(gl-tooltip):not(formatted-date):not(gl-avatar),
	.scope-row--excluded .scope-row__label-text,
	.scope-row--excluded formatted-date::part(base),
	.scope-row--excluded gl-avatar::part(avatar),
	.scope-row--excluded .scope-row__dot-col > * {
		opacity: 0.4;
	}

	.scope-row--loading > *:not(.scope-row__dot-col):not(gl-tooltip):not(formatted-date):not(gl-avatar),
	.scope-row--loading .scope-row__label-text,
	.scope-row--loading formatted-date::part(base),
	.scope-row--loading gl-avatar::part(avatar),
	.scope-row--loading .scope-row__dot-col > * {
		opacity: 0.6;
	}

	.scope-row__label--dimmed {
		color: var(--vscode-descriptionForeground);
		font-style: italic;
	}

	.scope-row__dot-col {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		flex-shrink: 0;
		align-self: stretch;
	}

	/* Connector lines — span the dot-col with square ends so they don't render
	   a visible rounded cap near the dot edge. */
	.scope-row__connector {
		position: absolute;
		left: 50%;
		width: 2px;
		transform: translateX(-50%);
		background: var(--color-graph-track, ${pushedColor});
	}

	/* The full gap between two dots takes the UPPER commit's color: the row's
	   own --below uses its state, and the row's --above uses the previous
	   row's state. Both segments meet across the row boundary in one color. */
	.scope-row[data-state='uncommitted'] .scope-row__connector--below {
		background: ${uncommittedColor};
	}

	.scope-row[data-state='unpushed'] .scope-row__connector--below {
		background: ${unpushedColor};
	}

	.scope-row[data-prev-state='uncommitted'] .scope-row__connector--above {
		background: ${uncommittedColor};
	}

	.scope-row[data-prev-state='unpushed'] .scope-row__connector--above {
		background: ${unpushedColor};
	}

	/* Connectors stop short of the dot edge (dot radius 0.8rem + 2px gap) so
	   the line reads as joining dots rather than running through them. */
	.scope-row__connector--above {
		top: 0;
		bottom: calc(50% + 0.8rem + 2px);
	}

	.scope-row__connector--below {
		top: calc(50% + 0.8rem + 2px);
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scope-row__date {
		color: var(--vscode-descriptionForeground);
		font-size: var(--gl-font-sm);
		flex-shrink: 0;
	}

	.scope-row__avatar {
		--gl-avatar-size: 1.8rem;
		flex-shrink: 0;
		margin-left: auto;
	}

	/* BASE badge on the merge-base row, in place of the date column.
	   Styled to match the compose post-result base tag visual. */
	.scope-row__base-tag {
		flex-shrink: 0;
		margin-left: auto;
		font-size: var(--gl-font-micro);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.4rem;
		border-radius: 0.3rem;
		background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
		color: var(--vscode-descriptionForeground);
	}

	.scope-row__stats {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
	}

	/* Drag handle — sits between rows */
	.scope-handle {
		position: relative;
		z-index: 2;
		cursor: ns-resize;
		padding: 0.3rem 0;
		touch-action: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Connector line through the drag handle gap — colored by the UPPER row's
	   state via data-state, mirroring the row connector rule. */
	.scope-handle::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(1.2rem + 7px);
		width: 2px;
		transform: translateX(-50%);
		background: var(--color-graph-track, ${pushedColor});
	}

	.scope-handle[data-state='uncommitted']::before {
		background: ${uncommittedColor};
	}

	.scope-handle[data-state='unpushed']::before {
		background: ${unpushedColor};
	}

	.scope-handle__bar {
		position: relative;
		width: 5rem;
		height: 0.5rem;
		border-radius: 0.25rem;
		background-color: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
		opacity: 0.7;
		transition: opacity 0.15s ease;
	}

	.scope-handle:hover .scope-handle__bar,
	.scope-handle--active .scope-handle__bar {
		opacity: 0.85;
	}

	/*
	 * Dot state indicators
	 * All dots render at the same outer diameter (12px) using box-sizing: border-box
	 * so border-based dots don't grow larger than filled ones.
	 */
	.dot-uncommitted,
	.dot-unpushed,
	.dot-pushed,
	.dot-merge-base {
		position: relative;
		z-index: 1;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		flex-shrink: 0;
		box-sizing: border-box;
	}

	/* Uncommitted: dotted hollow circle (yellow) */
	.dot-uncommitted {
		border: 2px dotted ${uncommittedColor};
		background: ${bgColor};
	}

	/* Unpushed: solid hollow circle (green) */
	.dot-unpushed {
		border: 3px solid ${unpushedColor};
		background: ${bgColor};
	}

	/* Pushed: filled circle (gray) */
	.dot-pushed {
		background: ${pushedColor};
	}

	/* Merge base: filled circle (gray, same as pushed) */
	.dot-merge-base {
		background: ${pushedColor};
	}

	/* Merge base row — matches the --excluded/--loading pattern so any
	   tooltip-hosting children (commit-stats, etc.) keep their popups at
	   full opacity while the row's visible content (and connector into
	   the base) dims uniformly. */
	.scope-row--merge-base {
		font-style: italic;
	}

	.scope-row--merge-base > *:not(.scope-row__dot-col):not(gl-tooltip):not(formatted-date):not(gl-avatar),
	.scope-row--merge-base .scope-row__label-text,
	.scope-row--merge-base formatted-date::part(base),
	.scope-row--merge-base gl-avatar::part(avatar),
	.scope-row--merge-base .scope-row__dot-col > * {
		opacity: 0.5;
	}
`;
