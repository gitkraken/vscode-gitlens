import { css } from 'lit';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';

export const panelHostStyles = [
	scrollableBase,
	css`
		:host {
			display: flex;
			flex-direction: column;
			flex: 1;
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
		flex-direction: column;
		align-items: stretch;
		flex: none;
	}

	.review-input-row > .review-action-input {
		margin-bottom: 0.2rem;
	}
`;

/* Resume bar — full-width clickable surface that replaces the older "Resume Last …" chip.
   Mirrors the visual language of `.compose-plan__header` / `.review-header` so the bar
   reads as a preview of the destination. Shared by review + compose panels. */
export const resumeBarStyles = css`
	.resume-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		margin: 0.6rem 0.6rem 0 0.6rem;
		flex: none;
		background: transparent;
		color: var(--vscode-foreground);
		border: 1px solid var(--vscode-button-border);
		border-radius: 0.3rem;
		cursor: pointer;
		font: inherit;
		text-align: left;
	}

	.resume-bar:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.resume-bar:focus-visible {
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
	}

	.resume-bar__title {
		font-size: var(--gl-font-base);
		font-weight: 500;
	}

	.resume-bar__count {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		margin-left: auto;
	}

	.resume-bar__count-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.resume-bar__count-item > code-icon {
		font-size: 1.2rem;
		opacity: 0.85;
	}

	.resume-bar__arrow {
		flex-shrink: 0;
		font-size: 1.4rem;
		opacity: 0.85;
		margin-left: 0.4rem;
	}

	/* When no preview data is available, the arrow follows the title directly — push it
	   to the far right so the bar's right edge still reads as the resume affordance. */
	.resume-bar > .resume-bar__title:first-child + .resume-bar__arrow {
		margin-left: auto;
	}
`;

export const panelLoadingStyles = css`
	.review-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
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

export const panelStaleBannerStyles = css`
	.stale-banner {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.8rem;
		font-size: var(--gl-font-base);
		color: var(--vscode-editorWarning-foreground, #cca700);
		background-color: var(--vscode-editorWarning-background, rgba(204, 167, 0, 0.1));
		border-radius: 0.4rem;
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
		height: 100%;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
		padding: 0.6rem;
	}

	.scope-split__files {
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.scope-files {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}

	.scope-files__tree {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		margin-top: 0.4rem;
		padding-left: 0.6rem;
		padding-right: 0.6rem;
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
		gap: 0.8rem;
		padding: 1rem 1.2rem;
		margin: 0.8rem 1.2rem;
		font-size: var(--gl-font-base);
		color: var(--vscode-foreground);
		background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.08));
		border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
		border-radius: 0.4rem;
	}

	.panel-error__header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.panel-error__icon {
		flex-shrink: 0;
		color: var(--vscode-editorError-foreground);
		font-size: 1.4rem;
	}

	.panel-error__title {
		font-weight: 600;
		color: var(--vscode-foreground);
	}

	.panel-error__message {
		color: var(--vscode-foreground);
		line-height: 1.4;
		word-break: break-word;
	}

	.panel-error__actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}
`;
