import { css } from 'lit';

export {
	panelActionInputStyles,
	panelErrorStyles,
	panelHostStyles,
	panelLoadingStyles,
	panelScopeSplitStyles,
	panelStaleBannerStyles,
	resumeBarStyles,
} from './shared-panel.css.js';

export const composeModePanelStyles = css`
	/* Slide-up entrance with overflow pinned to hidden until animationend so the inner
	   scroll containers don't flicker a scrollbar as the transform settles. After the
	   animation completes, :host([data-anim-done]) below restores overflow-y: auto. */
	:host {
		animation: sub-panel-enter 0.2s ease-out;
		overflow: hidden;
	}

	:host([data-anim-done]) {
		overflow-y: auto;
	}

	@media (prefers-reduced-motion: reduce) {
		:host {
			animation: none;
			overflow-y: auto;
		}
	}

	.compose-panel {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.stale-banner {
		margin: 0.4rem 1.2rem 0;
	}

	.compose-plan {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.compose-plan__header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		flex: none;
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
		align-items: center;
		gap: 0.6rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		margin-left: auto;
	}

	.compose-plan__count-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.compose-plan__count-item > code-icon {
		font-size: 1.2rem;
		opacity: 0.85;
	}

	/* Cancel button below the loading spinner — lets the user abort an in-flight
	   Compose or Refine call without waiting on the AI to resolve. */
	.compose-cancel {
		align-self: center;
		margin-top: 1rem;
		margin-bottom: 1.2rem;
	}

	/* Wraps the loading branch so the vertical-stream animation can sit behind the spinner +
	   progress text + cancel block. The stage takes the full available panel height; the
	   foreground sits on top, top-anchored. */
	.compose-loading-stage {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.compose-loading-stage > gl-categorizing-loading-animation {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 0;
	}

	.compose-loading-foreground {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		flex: none;
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
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	/* Commit All row is always anchored to the top of the right pane, above the file-tree-pane.
	   Fixed-height row so the file pane fills the rest of the column. */
	.compose-plan__commit-all {
		flex: none;
		display: flex;
		padding: 0.6rem 1.2rem;
	}

	.compose-plan__commit-all > gl-button {
		width: 100%;
	}

	.compose-commit {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.5rem 1.2rem;
		cursor: pointer;
		border-left: 2px solid transparent;
		transition: background 0.1s;
	}

	.compose-commit:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.compose-commit:focus-visible {
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
	}

	.compose-commit--selected {
		/* Theme-aware selection tint — VS Code's list-active selection token resolves correctly
		   on both light and dark themes (the previous hardcoded rgba(86,156,214,0.08) was
		   invisible on light themes and produced an unintended blue cast on non-default themes). */
		background: var(--vscode-list-activeSelectionBackground);
		border-left-color: var(--vscode-charts-purple, #7c3aed);
	}

	.compose-commit--excluded .compose-commit__num,
	.compose-commit--excluded .compose-commit__info {
		opacity: 0.45;
	}

	.compose-commit__num {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
		font-weight: 700;
		color: var(--vscode-charts-green, #4ec9b0);
		min-width: 1.4rem;
		text-align: center;
	}

	.compose-commit__info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	/* Commit message — single-line summary with a dimmed body continuation (graph-row style).
	   The gl-popover anchor carries the inline message; hover reveals the full markdown. */
	gl-popover.compose-commit__message {
		--hide-delay: 100ms;
		--wa-z-index-tooltip: 10000;
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
		color: color-mix(in srgb, var(--vscode-descriptionForeground) 75%, transparent);
		margin-left: 0.8rem;
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

	/* Include/exclude toggle — gl-button skinned as a checkbox.
	   Checked (included): solid green fill, white checkmark.
	   Unchecked (excluded): dimmed border with a dimmed checkmark, transparent fill.
	   Hover previews the post-click state via the gl-button hover-background var. */
	.compose-commit__action {
		flex-shrink: 0;
		--button-padding: 0.3rem;
		--button-padding-inline: 0.3rem;
		--button-width: 2rem;
		--button-line-height: 1;
		--button-gap: 0;
		--code-icon-size: 1.2rem;
		--code-icon-v-align: middle;
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
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 1.2rem 0.6rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		border-top: 1px dashed var(--vscode-sideBarSectionHeader-border);
		margin-top: 0.4rem;
	}

	.compose-base__marker {
		font-size: 1.4rem;
		min-width: 1.4rem;
		text-align: center;
		opacity: 0.7;
		flex-shrink: 0;
	}

	.compose-base__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.compose-base__headline {
		color: var(--vscode-foreground);
		opacity: 0.75;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.compose-base__meta {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
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
		font-size: var(--gl-font-micro);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.4rem;
		border-radius: 0.3rem;
		background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
		color: var(--vscode-descriptionForeground);
	}

	/* When the splitter is in play, the file-tree-pane sits in a flex column inside the
	   split-end slot. Drop the standalone margin-top so the split divider sits flush against
	   the file-tree-pane's header (the divider IS the visual separator now). */
	.compose-plan__split-end > gl-file-tree-pane {
		margin-top: 0;
	}
`;
