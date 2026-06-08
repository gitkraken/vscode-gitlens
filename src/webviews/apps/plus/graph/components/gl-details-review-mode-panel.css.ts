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
		flex: 1;
		flex-direction: column;
		gap: 1rem;
		align-items: center;
		justify-content: center;
		min-height: 0;
		padding: 2.4rem 1.2rem;
		text-align: center;
	}

	.review-idle__scope {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: var(--gl-font-base);
		font-weight: 500;
		color: var(--vscode-foreground);
	}

	.review-idle__desc {
		max-width: 24rem;
		font-size: var(--gl-font-base);
		line-height: 1.5;
		color: var(--vscode-descriptionForeground);
	}

	/* Review panel */

	.review-panel {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	/* Footer pinned beneath the scrollable results — keeps the review-level Send-to-AI / Copy
	   actions reachable regardless of scroll position. Send-to-AI is the primary action and
	   stretches to fill the row; Copy is a compact icon-only secondary button trailing it. */

	/* Send (primary) + Copy (icon-only secondary) sit as a centered, adjacent pair. */
	.review-footer {
		display: flex;
		flex: none;
		gap: 0.6rem;
		align-items: center;
		justify-content: center;
		padding: 0.8rem 1.2rem;
		background: var(--gl-metadata-bar-bg, transparent);
		border-top: 1px solid var(--gl-metadata-bar-border, var(--vscode-widget-border));
	}

	.review-footer__copy gl-button {
		--button-padding-inline: 0.6rem;
	}

	/* Review results */

	.review-results {
		flex: 1;
		min-height: 0;
		padding: 1.2rem;
		overflow-y: auto;
	}

	/* Framing header above the AI-generated review summary — provides a labeled gap from the
	   embedded metadata bar and a back-to-files button to return to the file curation view. */

	.review-header {
		display: flex;
		flex: none;
		gap: 0.4rem;
		align-items: center;
		padding: 0.6rem 1.2rem;
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
		gap: 0.6rem;
		align-items: center;
		margin-left: auto;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.review-header__count-item {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
	}

	.review-header__count-item > code-icon {
		font-size: 1.2rem;
		opacity: 0.85;
	}

	.review-header__actions {
		display: inline-flex;
		flex-shrink: 0;
		gap: 0.2rem;
		align-items: center;
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
		flex-shrink: 0;
		gap: 0.2rem;
		align-items: center;
	}

	.review-finding__actions {
		display: inline-flex;
		flex-shrink: 0;
		gap: 0.2rem;
		align-items: center;
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
		flex: none;
		gap: 0.6rem;
		align-items: center;
		justify-content: space-between;
		min-height: var(--gl-metadata-bar-min-height);
		padding: 0 var(--gl-panel-padding-right, 1.2rem) 0 var(--gl-panel-padding-left, 1.2rem);
		font-size: var(--gl-font-sm);
		background-color: var(--gl-metadata-bar-bg);
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	.review-metadata__left {
		display: flex;
		flex: 1;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
		overflow: hidden;
	}

	.review-metadata__sha {
		flex-shrink: 0;
		font-size: var(--gl-font-base);
	}

	.review-metadata__dots {
		font-family: var(--vscode-editor-font-family, monospace);
		color: var(--color-foreground--50);
	}

	.review-metadata__right {
		display: flex;
		flex-shrink: 0;
		gap: 0.4rem;
		align-items: center;
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
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	.review-loading-stage > gl-categorizing-loading-animation {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
	}

	/* Loading state wrapper for the in-flight review — centers the shared spinner and the
	   Cancel chip as a vertical column so the spinner stays visually anchored. */
	.review-loading-wrap {
		position: relative;
		z-index: 1;
		display: flex;
		flex: none;
		flex-direction: column;
		gap: 1rem;
		align-items: center;
	}

	.review-cancel {
		margin-bottom: 1.2rem;
	}

	/* Review scope toggle */

	.review-scope__toggle {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: inherit;
		cursor: pointer;
	}

	.review-scope__toggle input[type='checkbox'] {
		cursor: pointer;
	}

	/* Review overview */

	.review-overview {
		padding: 0.8rem;
		margin-bottom: 0.8rem;
		line-height: 1.5;
		border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
		border-radius: 0.4rem;
	}

	.review-overview__text {
		color: var(--vscode-foreground);
		overflow-wrap: anywhere;
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
		gap: 0.6rem;
		align-items: center;
		padding: 1.5rem 1rem;
		font-weight: 500;
		color: var(--vscode-charts-green, #4ec9b0);
	}

	/* Review areas */

	/* Section header — matches the home panel's section pattern (branch-section, summary):
	   1.3rem, normal weight, uppercase, foreground color. */
	.review-areas__header-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		padding: 0.4rem 0;
	}

	.review-areas__header {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 1.3rem;
		font-weight: normal;
		color: var(--vscode-foreground);
		text-transform: uppercase;
	}

	.review-areas__actions {
		display: inline-flex;
		flex-shrink: 0;
		gap: 0.2rem;
		align-items: center;
	}

	.review-area {
		margin-bottom: 0.6rem;
		overflow: hidden;
		border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
		border-radius: 0.4rem;
	}

	.review-area__header {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		width: 100%;
		padding: 0.6rem 0.8rem;
		font-family: var(--vscode-font-family);
		font-size: var(--gl-font-base);
		color: var(--vscode-foreground);
		text-align: left;
		cursor: pointer;
		background: transparent;
		border: none;
	}

	.review-area__header:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.review-area__header:focus-visible {
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
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
		min-width: 0;
		font-weight: 500;
		overflow-wrap: anywhere;
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
		margin-bottom: 0.6rem;
		font-size: var(--gl-font-base);
		line-height: 1.4;
		color: var(--vscode-descriptionForeground);
		overflow-wrap: anywhere;
	}

	.review-area__files {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-bottom: 0.6rem;
	}

	.review-area__file-link {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		padding: 0.2rem 0.4rem;
		font-family: var(--vscode-editor-font-family);
		font-size: var(--gl-font-base);
		color: var(--vscode-textLink-foreground);
		text-align: left;
		cursor: pointer;
		background: transparent;
		border: none;
		border-radius: 0.2rem;
	}

	.review-area__file-link:hover {
		background: var(--vscode-list-hoverBackground);
	}

	/* Underline only the filename text on hover — without this scope, the rule applies to the
	   whole button and the icon picks up a stray underline at its baseline. */
	.review-area__file-link:hover .review-area__file-link-text {
		text-decoration: underline;
	}

	.review-area__file-link-icon {
		flex: 0 0 auto;
		color: var(--vscode-foreground);
		opacity: 0.7;
	}

	.review-area__file-link-text {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.review-area__file-link-lines {
		flex: 0 0 auto;
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--50, var(--vscode-descriptionForeground));
	}

	.review-area__analyze-btn {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		padding: 0.4rem 0.8rem;
		font-family: var(--vscode-font-family);
		font-size: var(--gl-font-base);
		color: var(--vscode-button-foreground);
		cursor: pointer;
		background: var(--vscode-button-background);
		border: none;
		border-radius: 0.3rem;
	}

	.review-area__analyze-btn:hover {
		background: var(--vscode-button-hoverBackground);
	}

	.review-area__analyze-btn:focus-visible {
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: 0.1rem;
	}

	.review-area__loading,
	.review-area__error,
	.review-area__clean {
		display: flex;
		gap: 0.4rem;
		align-items: center;
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
		font-family: inherit;
		font-size: inherit;
		color: var(--vscode-textLink-foreground);
		text-decoration: underline;
		cursor: pointer;
		background: transparent;
		border: none;
	}

	.review-area__retry-btn:focus-visible {
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: 0.1rem;
		border-radius: 0.2rem;
	}

	/* Review findings */

	.review-findings {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}

	.review-finding {
		/* Flex column so the .review-finding__location <button> (display: flex) becomes a flex
		   item with align-items: stretch — gives it a constrained cross-axis width so its
		   shrinkable text child actually ellipsizes instead of pushing the button past the card
		   edge at narrow widths. Mirrors the .review-area__files → .review-area__file-link
		   pattern above. */
		display: flex;
		flex-direction: column;
		padding: 0.6rem 0.8rem;
		background: var(--vscode-editor-inactiveSelectionBackground, rgb(255 255 255 / 4%));
		border-left: 3px solid transparent;
		border-radius: 0.3rem;
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
		gap: 0.5rem;

		/* baseline (not center) — the title wraps to multiple lines; with center alignment the
		   badge floats up to the visual middle of the whole title block and reads as
		   misaligned. Baseline locks the badge's text baseline to the title's first-line
		   baseline so they look like they sit on the same line of text. */
		align-items: baseline;
		margin-bottom: 0.4rem;
	}

	.review-finding__severity {
		flex: 0 0 auto;

		/* Symmetric vertical padding so the badge box stays balanced around the text — paired
		   with baseline alignment above, this keeps the badge optically on the same line as
		   the title text. */
		padding: 0.15rem 0.4rem;
		font-size: var(--gl-font-micro);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-radius: 0.2rem;
	}

	/* Mix the badge background against the matching VS Code semantic foreground token so the
	   tint follows the active theme. The prior hardcoded rgba(255,0,0,...) style produced
	   clashes on themes whose error/warning/info hues aren't the default red/orange/blue. */
	.review-finding__severity--critical {
		color: var(--vscode-editorError-foreground);
		background: color-mix(in srgb, var(--vscode-editorError-foreground) 12%, transparent);
	}

	.review-finding__severity--warning {
		color: var(--vscode-editorWarning-foreground);
		background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 12%, transparent);
	}

	.review-finding__severity--suggestion {
		color: var(--vscode-editorInfo-foreground);
		background: color-mix(in srgb, var(--vscode-editorInfo-foreground) 12%, transparent);
	}

	.review-finding__title {
		flex: 1;
		min-width: 0;
		font-size: var(--gl-font-base);
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	.review-finding__description {
		margin-bottom: 0.4rem;
		font-size: var(--gl-font-base);
		line-height: 1.4;
		color: var(--vscode-descriptionForeground);
		overflow-wrap: anywhere;
	}

	.review-finding__location {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		font-family: var(--vscode-editor-font-family);
		font-size: var(--gl-font-sm);
		color: var(--vscode-textLink-foreground);
		cursor: pointer;
		background: transparent;
		border: none;
	}

	/* Underline only the filename text on hover — without this scope, the rule applies to the
	   whole button and the icon picks up a stray underline at its baseline. Mirrors the
	   .review-area__file-link:hover behavior on the top-level focus-area file list. */
	.review-finding__location:hover .review-finding__location-text {
		text-decoration: underline;
	}

	.review-finding__location-icon {
		flex: 0 0 auto;
		color: var(--vscode-foreground);
		opacity: 0.7;
	}

	.review-finding__location-text {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.review-finding__location-lines {
		flex: 0 0 auto;
		color: var(--color-foreground--50, var(--vscode-descriptionForeground));
	}

	.review-findings__dismissed {
		padding: 0.4rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		text-align: center;
		cursor: pointer;
		background: transparent;
		border: none;
	}

	.review-findings__dismissed:hover {
		color: var(--vscode-textLink-foreground);
	}

	.review-findings__dismissed:focus-visible {
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
		border-radius: 0.2rem;
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
		gap: 0.4rem;
		align-items: center;
	}

	webview-pane [slot='title'] {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
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
