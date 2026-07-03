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

		/* Commit = green, recompose = orange — authored in OKLCH at the SAME lightness (0.6) so the
		   pair reads as one system (only the hue differs). Shared by the per-commit checkmarks and
		   the recompose submit so the orange stays identical between them. Fixed rather than
		   relative-from-token, which drifted the orange much darker. */
		--gl-compose-commit-accent: oklch(0.6 0.15 150);
		--gl-compose-recompose-accent: oklch(0.6 0.13 62);
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

	/* Unified action zone pinned to the bottom of the panel: the "Recompose Changes" gate on top,
	   then the primary action + Discard — a full-width Commit button in commit posture, or the
	   detached refine input (its own submit + slotted Discard) in refine posture — then the hint. */
	.compose-plan__actions {
		container: compose-actions / inline-size;
		display: flex;
		flex: none;
		flex-direction: column;
		gap: var(--gl-space-8);
		padding: var(--gl-space-8) var(--gl-space-12) var(--gl-space-10);
	}

	.compose-plan__gate {
		align-self: flex-start;
	}

	/* gl-checkbox brings its own margin-block, leaving a roomy gap under the gate. Once the panel is
	   wide enough that the left-aligned gate label and the right-anchored model tab can't collide,
	   drop that bottom margin to pull the input up tight. Narrower than this, keep the margin so the
	   tab drops clear below the gate row instead of overlapping it. */
	@container compose-actions (min-width: 44rem) {
		.compose-plan__gate {
			margin-bottom: 0;
		}
	}

	.compose-plan__action-row {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
	}

	.compose-plan__action-row > .compose-plan__commit {
		flex: 1;
		min-width: 0;
	}

	/* aria-disabled (not native disabled) keeps the commit button hoverable so its "why" tooltip
	   shows; dim it ourselves since gl-button only styles the native disabled state. */
	.compose-plan__commit[aria-disabled='true'] {
		cursor: default;
		opacity: 0.4;
	}

	/* Orange-tint the detached recompose submit with the SAME accent as the recompose checkmarks
	   (green/blue is reserved for commit). Custom props pierce the shadow boundary; gl-ai-input
	   falls back to --vscode-button-* when unset. */
	.compose-plan__actions gl-ai-input {
		--gl-ai-submit-bg: var(--gl-compose-recompose-accent);
		--gl-ai-submit-hover-bg: color-mix(in srgb, #000 15%, var(--gl-compose-recompose-accent));
	}

	/* The refine input self-insets/-centres via panelActionInputStyles; inside the already-padded
	   action zone that doubles the inset, so pin it flush to the zone's content box. */
	.compose-plan__actions > gl-ai-input.review-action-input {
		width: 100%;
		max-width: none;
		margin: 0;
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

	/* Dim the "held back" rows so the greyed row + empty checkmark both signal the row is being
	   skipped: commit posture dims the excluded rows, recompose posture dims the locked rows.
	   Neither adds a left-edge accent — that's reserved for selection (.compose-commit--selected). */
	.compose-plan:not(.compose-plan--refine) .compose-commit--excluded .compose-commit__num,
	.compose-plan:not(.compose-plan--refine) .compose-commit--excluded .compose-commit__info,
	.compose-plan--refine .compose-commit--refine-excluded .compose-commit__num,
	.compose-plan--refine .compose-commit--refine-excluded .compose-commit__info {
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

	/* Single per-commit checkmark. Top-aligned so it lines up with the row number and the inline
	   regen icon on the message line (the row is flex-start). */
	.compose-commit__actions {
		display: flex;
		flex-shrink: 0;
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

	/* Single per-commit checkmark. One shape; the checked state sets the fill and the posture sets
	   the colour: commit uses the standard checkbox palette (matches the gate + every other
	   checkbox), recompose fills orange. The check glyph uses --vscode-checkbox-foreground so it
	   flips with the theme and stays legible on either fill (light & dark). */
	.compose-commit__check {
		--button-padding: 0.3rem;
		--button-padding-inline: 0.3rem;
		--button-width: 2rem;
		--button-line-height: 1;
		--button-gap: 0;
		--code-icon-size: 1.2rem;
		--code-icon-v-align: middle;

		/* Checked fill: green in commit, orange in recompose (both dark enough that the white check
		   stays legible on the fill and the deepened hover). */
		--check-accent: var(--gl-compose-commit-accent);
	}

	.compose-plan--refine .compose-commit__check {
		--check-accent: var(--gl-compose-recompose-accent);
	}

	/* Always render the check glyph so the box keeps a constant size; hide it (space reserved) when
	   unchecked instead of removing it, which collapsed the button height. */
	.compose-commit__check--off code-icon {
		visibility: hidden;
	}

	/* Checked — accent fill + white check; hover deepens the fill (check stays legible). */
	.compose-commit__check--on {
		--button-foreground: var(--vscode-button-foreground, #fff);
		--button-background: var(--check-accent);
		--button-border: var(--check-accent);
		--button-hover-background: color-mix(in srgb, #000 25%, var(--check-accent));
	}

	/* Empty — dim outline; hover previews the accent fill + border. */
	.compose-commit__check--off {
		--button-foreground: var(--vscode-button-foreground, #fff);
		--button-background: transparent;
		--button-border: var(--color-foreground--50);
		--button-hover-background: color-mix(in srgb, var(--check-accent) 22%, transparent);
	}

	.compose-commit__check--off:hover {
		--button-border: var(--check-accent);
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
