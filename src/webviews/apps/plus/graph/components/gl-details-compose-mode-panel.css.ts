import { css } from 'lit';

export {
	panelActionInputStyles,
	panelErrorStyles,
	panelHostStyles,
	panelLoadingStageStyles,
	panelLoadingStyles,
	panelScopeSplitStyles,
	panelStaleBannerStyles,
	resumeBarStyles,
} from './shared-panel.css.js';

export const composeModePanelStyles = css`
	/* Scrollable at rest; the sub-panel-enter keyframe pins overflow hidden for the duration of the
	   slide-up so the inner scroll containers can't flash a scrollbar as the transform settles (see
	   subPanelEnterStyles). No JS latch needed — the animation's lifetime is the gate. */
	:host {
		overflow-y: auto;
		animation: sub-panel-enter var(--gl-duration-medium) var(--gl-ease-out);
	}

	@media (prefers-reduced-motion: reduce) {
		:host {
			animation: none;
		}
	}

	.compose-panel {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}

	.stale-banner {
		margin: var(--gl-space-4) var(--gl-space-12) 0;
	}

	.compose-plan {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}

	.compose-plan__header {
		display: flex;
		flex: none;
		gap: var(--gl-space-4);
		align-items: center;
		padding: var(--gl-space-4) var(--gl-space-8);
	}

	.compose-plan__back {
		flex-shrink: 0;
	}

	.compose-plan__title {
		font-size: var(--gl-font-base);
		font-weight: 500;
		color: var(--vscode-foreground);
	}

	.compose-plan__count {
		display: inline-flex;
		gap: var(--gl-space-6);
		align-items: center;
		margin-left: auto;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.compose-plan__count-item {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
	}

	.compose-plan__count-item > code-icon {
		font-size: var(--gl-font-md);
		opacity: 0.85;
	}

	/* Cancel button below the loading spinner — lets the user abort an in-flight
	   Compose or Refine call without waiting on the AI to resolve. */
	.compose-cancel {
		align-self: center;
		margin-top: var(--gl-space-10);
		margin-bottom: var(--gl-space-12);
	}

	.compose-plan__list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	/* Split between proposed-commits list and selected-commit files. Always rendered — when
	   no commit is selected, the file pane shows its empty-state message. */
	.compose-plan__split {
		flex: 1;
		min-height: 0;

		/* Size the start track to the commits list (capped at the drag position) instead of a
		   fixed 50%, so a short list doesn't leave the divider + border-bottom floating in empty
		   space far below the last commit. Mirrors panelScopeSplitStyles' .scope-split. */
		--gl-split-panel-start-size: fit-content(var(--_start-size, 50%));
	}

	.compose-plan__split-start,
	.compose-plan__split-end {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}

	/* Border on the bottom of the scope section (proposed-commits list) so the divider
	   sits flush against it. */
	.compose-plan__split-start {
		border-bottom: var(--gl-border-width) solid var(--vscode-sideBarSectionHeader-border);
	}

	/* Commit All row is always anchored to the top of the right pane, above the file-tree-pane.
	   Fixed-height row so the file pane fills the rest of the column. */
	.compose-plan__commit-all {
		display: flex;
		flex: none;
		gap: var(--gl-space-8);
		padding: var(--gl-space-6) var(--gl-space-12);
	}

	.compose-plan__commit-all > gl-button[full] {
		flex: 1;
		min-width: 0;
	}

	.compose-commit {
		display: flex;
		gap: var(--gl-space-6);
		align-items: flex-start;
		padding: 0.5rem 1.2rem;
		cursor: pointer;
		border-left: 2px solid transparent;
		transition: background var(--gl-duration-x-fast);
	}

	.compose-commit:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.compose-commit:focus-visible {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
	}

	.compose-commit--selected {
		/* Theme-aware selection tint — VS Code's list-active selection token resolves correctly
		   on both light and dark themes (the previous hardcoded rgba(86,156,214,0.08) was
		   invisible on light themes and produced an unintended blue cast on non-default themes). */
		background: var(--vscode-list-activeSelectionBackground);
		border-left-color: var(--gl-agent-working-color);
	}

	/* Locked rows get an amber accent on the leading border — visible at a glance that the
	   AI is forbidden from changing them. Number + message stay full-opacity since locked
	   commits ARE rendered in the plan; lock is a refine-time constraint, not visibility. */
	.compose-commit--locked {
		border-left-color: var(--vscode-charts-orange, #d18616);
	}

	/* Excluded rows are visually dimmed — they're still in the plan view but will NOT be
	   applied on the next "Commit". The number + info dim together; the include toggle's
	   own dimmed state reinforces that the commit is being skipped. */
	.compose-commit--excluded .compose-commit__num,
	.compose-commit--excluded .compose-commit__info {
		opacity: 0.45;
	}

	.compose-commit__num {
		flex-shrink: 0;
		min-width: 1.4rem;
		font-size: var(--gl-font-sm);
		font-weight: 700;
		color: var(--vscode-charts-green, #4ec9b0);
		text-align: center;
	}

	.compose-commit__info {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	/* Message + per-commit regen icon share a row. The popover flexes to fill; the icon stays
	   pinned at the trailing edge as a compact toolbar button. Without an explicit min-width:0
	   on the popover, the icon would push the text past the row's edge instead of letting it
	   ellipsize. */
	.compose-commit__message-row {
		display: flex;
		gap: var(--gl-space-4);
		align-items: center;
		min-width: 0;
	}

	.compose-commit__message-row gl-popover.compose-commit__message {
		flex: 1;
		min-width: 0;
	}

	/* Commit message — single-line summary with a dimmed body continuation (graph-row style).
	   The gl-popover anchor carries the inline message; hover reveals the full markdown. */
	gl-popover.compose-commit__message {
		--hide-delay: 100ms;

		display: flex;
		min-width: 0;
		overflow: hidden;
		font-size: var(--gl-font-base);
		color: var(--vscode-foreground);
	}

	gl-popover.compose-commit__message::part(base__popup),
	gl-popover.compose-commit__message::part(base__hover-bridge),
	gl-popover.compose-commit__message::part(body) {
		pointer-events: none;
	}

	gl-popover.compose-commit__message::part(body) {
		max-height: 50vh;
		overflow-y: auto;
	}

	.compose-commit__message-content {
		display: flex;
		align-items: center;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.compose-commit__message-body {
		margin-left: var(--gl-space-8);
		color: color-mix(in srgb, var(--vscode-descriptionForeground) 75%, transparent);
	}

	.compose-commit__stats {
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.compose-commit__additions {
		color: var(--vscode-gitDecoration-addedResourceForeground, #2ea043);
	}

	.compose-commit__deletions {
		color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
	}

	/* Two stacked toggle buttons per commit row: lock (refine-time) above, include (apply-time)
	   below. The wrapper keeps them grouped and prevents the gl-button widths from drifting. */
	.compose-commit__actions {
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		gap: var(--gl-space-2);
	}

	/* Both toggles share the same chrome (size, icon scale, hover semantics) and only diverge
	   on the active-color palette. Defined here as the base; the --lock / --include modifiers
	   set the accent and active-state styling below. */
	.compose-commit__action {
		--button-padding: 0.3rem;
		--button-padding-inline: 0.3rem;
		--button-width: 2rem;
		--button-line-height: 1;
		--button-gap: 0;
		--code-icon-size: 1.2rem;
		--code-icon-v-align: middle;
	}

	/* Regen-message icon — lives inline with the commit message (not in the right-side actions
	   cluster) and stays subtle: dimmed by default, full opacity on hover/focus. The spinning
	   icon during regen carries enough visual weight without a colored fill, so this variant
	   keeps the toolbar-button look and avoids competing with the lock/include accent colors. */
	.compose-commit__action--regen {
		flex-shrink: 0;
		opacity: 0.65;
	}

	.compose-commit__action--regen:hover:not([disabled]),
	.compose-commit__action--regen:focus-within:not([disabled]) {
		opacity: 1;
	}

	.compose-commit__action--regen[disabled] {
		opacity: 0.35;
	}

	/* Lock toggle.
	   Default (unlocked): dimmed transparent button with an unlock icon — visible but not loud.
	   Locked: solid amber fill with a lock icon — pinned-by-user at a glance. */
	.compose-commit__action--lock {
		--lock-amber: color-mix(in srgb, #000 25%, var(--vscode-charts-orange, #d18616));

		--button-foreground: var(--color-foreground--50);
		--button-background: transparent;
		--button-border: var(--color-foreground--50);
		--button-hover-background: var(--lock-amber);
	}

	.compose-commit__action--lock:hover {
		--button-foreground: var(--vscode-button-foreground, #fff);
		--button-border: var(--lock-amber);
	}

	.compose-commit__action--locked {
		--button-foreground: var(--vscode-button-foreground, #fff);
		--button-background: var(--lock-amber);
		--button-border: var(--lock-amber);
		--button-hover-background: color-mix(in srgb, #000 40%, var(--vscode-charts-orange, #d18616));
	}

	/* Include toggle — gl-button skinned as a checkbox.
	   Checked (included): solid green fill, white checkmark.
	   Unchecked (excluded): dimmed border with a dimmed checkmark, transparent fill.
	   Hover previews the post-click state via the gl-button hover-background var. */
	.compose-commit__action--include {
		--check-green: color-mix(in srgb, #000 35%, var(--vscode-testing-iconPassed, #73c991));

		/* --vscode-button-foreground is the contrast-paired token for --vscode-button-background
		   and resolves to white on most themes; falling back to literal white preserves the
		   original intent on themes that don't define the variable. */
		--button-foreground: var(--vscode-button-foreground, #fff);
		--button-background: var(--check-green);
		--button-border: var(--check-green);
		--button-hover-background: color-mix(in srgb, #000 50%, var(--vscode-testing-iconPassed, #73c991));
	}

	.compose-commit__action--excluded {
		--button-foreground: var(--color-foreground--50);
		--button-background: transparent;
		--button-border: var(--color-foreground--50);
		--button-hover-background: var(--check-green);
	}

	.compose-commit__action--excluded:hover {
		--button-foreground: var(--vscode-button-foreground, #fff);
		--button-border: var(--check-green);
	}

	.compose-base {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		padding: var(--gl-space-4) var(--gl-space-12) var(--gl-space-6);
		margin-top: var(--gl-space-4);
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		border-top: var(--gl-border-width) dashed var(--vscode-sideBarSectionHeader-border);
	}

	.compose-base__marker {
		flex-shrink: 0;
		min-width: 1.4rem;
		font-size: var(--gl-font-lg);
		text-align: center;
		opacity: 0.7;
	}

	.compose-base__body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.compose-base__headline {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--vscode-foreground);
		white-space: nowrap;
		opacity: 0.75;
	}

	.compose-base__meta {
		display: inline-flex;
		gap: var(--gl-space-4);
		align-items: center;
		min-width: 0;
		font-size: var(--gl-font-micro);
	}

	.compose-base__sha {
		font-family: var(--vscode-editor-font-family, monospace);
	}

	.compose-base__author {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.compose-base__date {
		flex-shrink: 0;
	}

	.compose-base__dot {
		opacity: 0.6;
	}

	.compose-base__tag {
		flex-shrink: 0;
		padding: 0.1rem 0.4rem;
		font-size: var(--gl-font-micro);
		color: var(--vscode-descriptionForeground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
		border-radius: var(--gl-radius-sm);
	}

	/* When the splitter is in play, the file-tree-pane sits in a flex column inside the
	   split-end slot. Drop the standalone margin-top so the split divider sits flush against
	   the file-tree-pane's header (the divider IS the visual separator now). */
	.compose-plan__split-end > gl-file-tree-pane {
		margin-top: 0;
	}
`;
