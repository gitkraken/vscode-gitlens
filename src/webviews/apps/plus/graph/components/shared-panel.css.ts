import { css } from 'lit';
import { scrollableBase } from '@gitlens/components/components/styles/lit/base.css.js';

export const panelHostStyles = [
	scrollableBase,
	css`
		:host {
			display: flex;
			flex: 1;
			flex-direction: column;
			min-height: 0;
			overflow-y: auto;
			border-color: transparent;
			transition: border-color 1s linear;
		}

		:host(:hover),
		:host(:focus-within) {
			border-color: var(--vscode-scrollbarSlider-background);
			transition: none;
		}
	`,
];

/** Autolinks chip strip shared by the compare and multi-commit panels, so the "No Autolinks Found"
 *  affordance and the loading pseudo-row read identically in both. Panels layer their own overrides
 *  on top — the multi-commit strip wraps, the compare strip stays single-row. */
export const panelAutolinkStripStyles = css`
	.compare-enrichment {
		display: flex;
		flex: none;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
		padding: var(--gl-space-4) var(--gl-space-12);
		font-size: var(--gl-font-sm);
	}

	.compare-enrichment gl-action-chip[data-action='autolink-settings'] {
		color: var(--color-foreground--65);
		--code-icon-size: 1.2rem;
	}

	.compare-enrichment gl-action-chip::part(base) {
		gap: var(--gl-space-4);
	}

	.compare-enrichment gl-action-chip::part(icon) {
		display: inline-flex;
		align-items: center;
		line-height: 1;
	}

	/* Inline autolinks loading state — replaces the "No autolinks found" affordance while the
	   comparison identity is changing. min-height matches gl-action-chip's intrinsic 2rem so the
	   strip doesn't jump between the spinner and the chip-based states. */
	.compare-enrichment__loading {
		display: inline-flex;
		gap: var(--gl-space-4);
		align-items: center;
		min-height: 2rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}
`;

export const panelActionInputStyles = css`
	.review-action-input,
	gl-ai-input,
	gl-compare-ai-actions {
		flex: none;
		width: calc(100% - var(--gl-panel-padding-left, 1.2rem) - var(--gl-panel-padding-right, 1.2rem));
		max-width: var(--gl-max-input);
		margin: 0.2rem auto;
	}

	.review-action-input {
		margin: 0.6rem auto 0.8rem;
	}

	/* Wraps the AI input so adjacent affordances can sit below it. */
	.review-input-row {
		display: flex;
		flex: none;
		flex-direction: column;
		align-items: stretch;
	}

	.review-input-row > .review-action-input {
		margin-bottom: var(--gl-space-2);
	}
`;

export const panelLoadingStyles = css`
	.review-loading {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-10);
		align-items: center;
		justify-content: center;
		padding: 3rem 1rem 0;
		color: var(--vscode-descriptionForeground);
	}

	.review-loading__spinner {
		--code-icon-size: 20px;
	}

	.review-loading__text {
		font-size: var(--gl-font-base);
	}
`;

/* Loading "stage" shared by the compose/review/resolve mode panels: a full-height relative
   container with the background particle animation pinned behind a top-anchored foreground.
   The animation is targeted by the `__anim` class (not its tag) so the rule is agnostic to which
   loader sits inside. Consumers add their own foreground spacing (gap/align) as needed. */
export const panelLoadingStageStyles = css`
	.panel-loading-stage {
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	.panel-loading-stage__anim {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
	}

	.panel-loading-stage__foreground {
		position: relative;
		z-index: 1;
		display: flex;
		flex: none;
		flex-direction: column;
	}
`;

export const panelStaleBannerStyles = css`
	.stale-banner {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		padding: var(--gl-space-6) var(--gl-space-8);
		font-size: var(--gl-font-base);
		color: var(--vscode-editorWarning-foreground, #cca700);
		background-color: var(--vscode-editorWarning-background, rgb(204 167 0 / 10%));
		border-radius: var(--gl-radius-sm);
	}

	.stale-banner code-icon {
		flex-shrink: 0;
	}
`;

export const panelScopeSplitStyles = css`
	/* Split panel between scope picker (top) and file curation (bottom). Shared by review + compose. */

	.scope-split {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		--gl-split-panel-divider-width: 4px;

		/* Always use fit-content so the scope area can't expand past its content.
		   Keeping the same CSS formula during drag avoids pixel jumps. */
		--gl-split-panel-start-size: fit-content(var(--_start-size, 40%));
	}

	.scope-split__picker {
		/* border-box so the padding + border-bottom live INSIDE height: 100% — otherwise (the UA
		   default content-box) they render outside the grid track, pushing the picker ~13px past
		   the split divider so the two overlap. */
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: var(--gl-space-6);
		overflow: hidden;
		border-bottom: var(--gl-border-width) solid var(--vscode-sideBarSectionHeader-border);
	}

	.scope-split__files {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.scope-files {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}

	.scope-files__tree {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		padding-right: var(--gl-space-6);
		padding-left: var(--gl-space-6);
		margin-top: var(--gl-space-4);
		overflow: hidden;
	}

	.scope-files__tree webview-pane-group {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
`;

export const panelErrorStyles = css`
	.panel-error {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		padding: var(--gl-space-10) var(--gl-space-12);
		margin: var(--gl-space-8) var(--gl-space-12);
		font-size: var(--gl-font-base);
		color: var(--vscode-foreground);
		background: var(--vscode-inputValidation-errorBackground, rgb(255 0 0 / 8%));
		border: var(--gl-border-width) solid
			var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
		border-radius: var(--gl-radius-sm);
	}

	.panel-error__header {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
	}

	.panel-error__icon {
		flex-shrink: 0;
		font-size: var(--gl-font-lg);
		color: var(--vscode-editorError-foreground);
	}

	.panel-error__title {
		font-weight: var(--gl-font-weight-semibold);
		color: var(--vscode-foreground);
	}

	.panel-error__message {
		line-height: 1.4;
		color: var(--vscode-foreground);
		overflow-wrap: anywhere;
	}

	.panel-error__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-6);
		justify-content: flex-end;
	}
`;
