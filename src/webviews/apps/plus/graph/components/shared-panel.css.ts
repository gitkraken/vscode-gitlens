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
	gl-ai-input {
		flex: none;
		width: calc(100% - var(--gl-panel-padding-left, 1.2rem) - var(--gl-panel-padding-right, 1.2rem));
		max-width: var(--gl-max-input);
		margin: 0.2rem auto;
	}
	.review-action-input {
		margin: 0.6rem auto 0.8rem;
	}

	/* Wraps the AI input so the Restore Previous chip can sit below it, right-aligned. */
	.review-input-row {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		flex: none;
	}

	.review-input-row > .review-action-input {
		margin-bottom: 0.2rem;
	}

	/* Restore Previous chip — appears below the AI input after the user has clicked Back to Files.
	   Click restores the previous AI result via mutate (no AI re-run). Auto-invalidated when the
	   user types in the AI input or modifies file selection. Right-aligned. */
	.review-forward {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.7rem;
		margin: 0 1.2rem 0.6rem auto;
		background: color-mix(
			in srgb,
			var(--gl-color-foreground--accent, var(--vscode-textLink-foreground)) 10%,
			transparent
		);
		color: var(--gl-color-foreground--accent, var(--vscode-textLink-foreground));
		border: 1px solid
			color-mix(in srgb, var(--gl-color-foreground--accent, var(--vscode-textLink-foreground)) 30%, transparent);
		border-radius: 0.4rem;
		font-size: var(--gl-font-sm);
		cursor: pointer;
		align-self: flex-end;
	}

	.review-forward:hover,
	.review-forward:focus-visible {
		background: color-mix(
			in srgb,
			var(--gl-color-foreground--accent, var(--vscode-textLink-foreground)) 20%,
			transparent
		);
		outline: none;
	}

	.review-forward > code-icon {
		font-size: 1.2rem;
	}
`;

export const panelLoadingStyles = css`
	.review-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 3rem 1rem;
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
		height: 100%;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
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
	.review-error {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 1rem;
		margin: 0.8rem 1.2rem;
		font-size: var(--gl-font-base);
		color: var(--vscode-editorError-foreground);
		background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
		border-radius: 0.4rem;
	}

	.review-error__retry {
		margin-left: auto;
		color: var(--vscode-textLink-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: inherit;
		font-family: inherit;
		text-decoration: underline;
	}

	.review-error__retry:hover {
		color: var(--vscode-textLink-activeForeground);
	}
`;
