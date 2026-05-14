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

export const reviewModePanelStyles = css`
	/* Matches the fade+slide-up entrance used by other graph details sub-panels so review
	   mode animates in instead of popping. @keyframes sub-panel-enter is provided by
	   subPanelEnterStyles in the component's styles array. */
	:host {
		animation: sub-panel-enter 0.2s ease-out;
	}

	@media (prefers-reduced-motion: reduce) {
		:host {
			animation: none;
		}
	}

	/* Review idle state */

	.review-idle {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 2.4rem 1.2rem;
		text-align: center;
		flex: 1;
		min-height: 0;
	}

	.review-idle__scope {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--gl-font-base);
		color: var(--vscode-foreground);
		font-weight: 500;
	}

	.review-idle__desc {
		font-size: var(--gl-font-base);
		color: var(--vscode-descriptionForeground);
		line-height: 1.5;
		max-width: 24rem;
	}

	/* Review panel */

	.review-panel {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* Review results */

	.review-results {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 1.2rem 1.2rem;
	}

	/* Framing header above the AI-generated review summary — provides a labeled gap from the
	   embedded metadata bar and a back-to-files button to return to the file curation view. */

	.review-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.6rem 1.2rem;
		flex: none;
	}

	.review-header__back {
		flex-shrink: 0;
	}

	.review-header__title {
		font-size: var(--gl-font-base);
		font-weight: 500;
		color: var(--vscode-foreground);
	}

	.review-header__count {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		margin-left: auto;
	}

	.review-header__count-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.review-header__count-item > code-icon {
		font-size: 1.2rem;
		opacity: 0.85;
	}

	.review-header__actions {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
		margin-left: 0.4rem;
	}

	.review-area__header-row {
		display: flex;
		align-items: center;
		padding-right: 0.4rem;
	}

	.review-area__header-row > .review-area__header {
		flex: 1;
		min-width: 0;
	}

	.review-area__actions {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
	}

	.review-finding__actions {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
		margin-left: auto;
	}

	.review-finding__actions gl-button,
	.review-finding__actions gl-copy-container {
		opacity: 0.7;
	}

	.review-finding:hover .review-finding__actions gl-button,
	.review-finding:hover .review-finding__actions gl-copy-container,
	.review-finding__actions gl-button:focus-within,
	.review-finding__actions gl-copy-container:focus-within {
		opacity: 1;
	}

	/* Compact metadata bar for compare-style review (multi-commit selection). Mirrors the
	   single-commit case (rendered by the host gl-details-commit-panel) and the comparison metadata
	   bar in gl-details-multicommit-panel — keeps the result framing consistent across scopes. */
	.review-metadata {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--gl-panel-padding-right, 1.2rem) 0 var(--gl-panel-padding-left, 1.2rem);
		gap: 0.6rem;
		flex: none;
		min-height: var(--gl-metadata-bar-min-height);
		font-size: var(--gl-font-sm);
		background-color: var(--gl-metadata-bar-bg);
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	.review-metadata__left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.review-metadata__sha {
		flex-shrink: 0;
		font-size: var(--gl-font-base);
	}

	.review-metadata__dots {
		color: var(--color-foreground--50);
		font-family: var(--vscode-editor-font-family, monospace);
	}

	.review-metadata__right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.review-metadata__count {
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.stale-banner {
		margin-bottom: 0.8rem;
	}

	/* Wraps the loading branch so the categorizing animation can sit behind the spinner +
	   cancel block. Stage takes the full panel height; foreground is top-anchored. */
	.review-loading-stage {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.review-loading-stage > gl-categorizing-loading-animation {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 0;
	}

	/* Loading state wrapper for the in-flight review — centers the shared spinner and the
	   Cancel chip as a vertical column so the spinner stays visually anchored. */
	.review-loading-wrap {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		flex: none;
	}

	.review-cancel {
		margin-bottom: 1.2rem;
	}

	/* Review scope toggle */

	.review-scope__toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		font-size: inherit;
	}

	.review-scope__toggle input[type='checkbox'] {
		cursor: pointer;
	}

	/* Review overview */

	.review-overview {
		padding: 0.8rem;
		margin-bottom: 0.8rem;
		line-height: 1.5;
		background: var(--vscode-editor-inactiveSelectionBackground, rgba(255, 255, 255, 0.04));
		border-radius: 0.4rem;
	}

	.review-overview__text {
		color: var(--vscode-foreground);
	}

	.review-overview__hint {
		display: block;
		margin-top: 0.6rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	/* Review clean */

	.review-clean {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 1.5rem 1rem;
		color: var(--vscode-charts-green, #4ec9b0);
		font-weight: 500;
	}

	/* Review areas */

	.review-areas__header {
		font-size: var(--gl-font-base);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--vscode-descriptionForeground);
		padding: 0.4rem 0;
		margin-bottom: 0.4rem;
	}

	.review-area {
		border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
		border-radius: 0.4rem;
		margin-bottom: 0.6rem;
		overflow: hidden;
	}

	.review-area__header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.6rem 0.8rem;
		font-size: var(--gl-font-base);
		font-family: var(--vscode-font-family);
		color: var(--vscode-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.review-area__header:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.review-area__chevron {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.review-area__severity {
		flex-shrink: 0;
	}

	.review-area__severity--critical {
		color: var(--vscode-editorError-foreground);
	}

	.review-area__severity--warning {
		color: var(--vscode-editorWarning-foreground);
	}

	.review-area__severity--suggestion {
		color: var(--vscode-editorInfo-foreground);
	}

	.review-area__label {
		flex: 1;
		font-weight: 500;
	}

	.review-area__file-count {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.review-area__body {
		padding: 0 0.8rem 0.8rem;
	}

	.review-area__rationale {
		font-size: var(--gl-font-base);
		line-height: 1.4;
		color: var(--vscode-descriptionForeground);
		margin-bottom: 0.6rem;
	}

	.review-area__files {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-bottom: 0.6rem;
	}

	.review-area__file-link {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.4rem;
		font-size: var(--gl-font-base);
		font-family: var(--vscode-editor-font-family);
		color: var(--vscode-textLink-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		border-radius: 0.2rem;
	}

	.review-area__file-link:hover {
		background: var(--vscode-list-hoverBackground);
		text-decoration: underline;
	}

	.review-area__analyze-btn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.8rem;
		font-size: var(--gl-font-base);
		font-family: var(--vscode-font-family);
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
		border: none;
		border-radius: 0.3rem;
		cursor: pointer;
	}

	.review-area__analyze-btn:hover {
		background: var(--vscode-button-hoverBackground);
	}

	.review-area__loading,
	.review-area__error,
	.review-area__clean {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.6rem;
		font-size: var(--gl-font-base);
		color: var(--vscode-descriptionForeground);
	}

	.review-area__error {
		color: var(--vscode-editorError-foreground);
	}

	.review-area__clean {
		color: var(--vscode-charts-green, #4ec9b0);
	}

	.review-area__retry-btn {
		color: var(--vscode-textLink-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		text-decoration: underline;
		font-size: inherit;
		font-family: inherit;
	}

	/* Review findings */

	.review-findings {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}

	.review-finding {
		padding: 0.6rem 0.8rem;
		background: var(--vscode-editor-inactiveSelectionBackground, rgba(255, 255, 255, 0.04));
		border-radius: 0.3rem;
		border-left: 3px solid transparent;
	}

	.review-finding[data-severity='critical'] {
		border-left-color: var(--vscode-editorError-foreground);
	}

	.review-finding[data-severity='warning'] {
		border-left-color: var(--vscode-editorWarning-foreground);
	}

	.review-finding[data-severity='suggestion'] {
		border-left-color: var(--vscode-editorInfo-foreground);
	}

	.review-finding__header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}

	.review-finding__severity {
		font-size: var(--gl-font-micro);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.4rem;
		border-radius: 0.2rem;
	}

	.review-finding__severity--critical {
		color: var(--vscode-editorError-foreground);
		background: rgba(255, 0, 0, 0.1);
	}

	.review-finding__severity--warning {
		color: var(--vscode-editorWarning-foreground);
		background: rgba(255, 165, 0, 0.1);
	}

	.review-finding__severity--suggestion {
		color: var(--vscode-editorInfo-foreground);
		background: rgba(0, 120, 255, 0.1);
	}

	.review-finding__title {
		flex: 1;
		font-weight: 500;
		font-size: var(--gl-font-base);
	}

	.review-finding__description {
		font-size: var(--gl-font-base);
		line-height: 1.4;
		color: var(--vscode-descriptionForeground);
		margin-bottom: 0.4rem;
	}

	.review-finding__location {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: var(--gl-font-sm);
		font-family: var(--vscode-editor-font-family);
		color: var(--vscode-textLink-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
	}

	.review-finding__location:hover {
		text-decoration: underline;
	}

	.review-findings__dismissed {
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: center;
		padding: 0.4rem;
	}

	.review-findings__dismissed:hover {
		color: var(--vscode-textLink-foreground);
	}

	.review-areas {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.checkbox-header {
		display: inline-flex;
		padding-left: 2px;
	}

	.checkbox-header gl-checkbox {
		--checkbox-foreground: var(--vscode-sideBarSectionHeader-foreground);
		--checkbox-size: 1.6rem;
		--checkbox-spacing: 0.6rem;
		--checkbox-radius: 0.3rem;
		--code-icon-size: 14px;
		margin-block: 0;
	}

	.checkbox-header gl-checkbox::part(label) {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	webview-pane [slot='title'] {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	webview-pane {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	webview-pane[flexible] {
		flex: 1;
		overflow: hidden;
	}
`;
