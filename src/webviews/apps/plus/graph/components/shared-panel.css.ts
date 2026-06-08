import { css } from 'lit';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';

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
		margin-bottom: 0.2rem;
	}
`;

/* Resume bar — full-width clickable surface that replaces the older "Resume Last …" chip.
   Mirrors the visual language of `.compose-plan__header` / `.review-header` so the bar
   reads as a preview of the destination. Shared by review + compose panels. */
export const resumeBarStyles = css`
	.resume-bar {
		display: flex;
		flex: none;
		gap: 0.4rem;
		align-items: center;
		padding: 0.4rem 0.8rem;
		margin: 0.6rem 0.6rem 0;
		font: inherit;
		color: var(--vscode-foreground);
		text-align: left;
		cursor: pointer;
		background: transparent;
		border: 1px solid var(--vscode-button-border);
		border-radius: 0.3rem;
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
		gap: 0.6rem;
		align-items: center;
		margin-left: auto;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.resume-bar__count-item {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
	}

	.resume-bar__count-item > code-icon {
		font-size: 1.2rem;
		opacity: 0.85;
	}

	.resume-bar__arrow {
		flex-shrink: 0;
		margin-left: 0.4rem;
		font-size: 1.4rem;
		opacity: 0.85;
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
		gap: 1rem;
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

export const panelStaleBannerStyles = css`
	.stale-banner {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		padding: 0.6rem 0.8rem;
		font-size: var(--gl-font-base);
		color: var(--vscode-editorWarning-foreground, #cca700);
		background-color: var(--vscode-editorWarning-background, rgb(204 167 0 / 10%));
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
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 0.6rem;
		overflow: hidden;
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
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
		padding-right: 0.6rem;
		padding-left: 0.6rem;
		margin-top: 0.4rem;
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
		gap: 0.8rem;
		padding: 1rem 1.2rem;
		margin: 0.8rem 1.2rem;
		font-size: var(--gl-font-base);
		color: var(--vscode-foreground);
		background: var(--vscode-inputValidation-errorBackground, rgb(255 0 0 / 8%));
		border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
		border-radius: 0.4rem;
	}

	.panel-error__header {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}

	.panel-error__icon {
		flex-shrink: 0;
		font-size: 1.4rem;
		color: var(--vscode-editorError-foreground);
	}

	.panel-error__title {
		font-weight: 600;
		color: var(--vscode-foreground);
	}

	.panel-error__message {
		line-height: 1.4;
		color: var(--vscode-foreground);
		overflow-wrap: anywhere;
	}

	.panel-error__actions {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
	}
`;
