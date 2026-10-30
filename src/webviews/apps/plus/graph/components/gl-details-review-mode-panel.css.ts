import { css } from 'lit';

export {
	panelActionInputStyles,
	panelErrorStyles,
	panelHostStyles,
	panelLoadingStageStyles,
	panelLoadingStyles,
	panelScopeSplitStyles,
} from './shared-panel.css.js';

export const reviewModePanelStyles = css`
	/* Matches the fade+slide-up entrance used by other graph details sub-panels so review
	   mode animates in instead of popping. @keyframes sub-panel-enter is provided by
	   subPanelEnterStyles in the component's styles array. */
	:host {
		animation: sub-panel-enter var(--gl-duration-medium) var(--gl-ease-out);
	}

	@media (prefers-reduced-motion: reduce) {
		:host {
			animation: none;
		}
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

	/* Send (primary) + Copy + Discard sit as a centered, adjacent group. */
	.review-footer {
		display: flex;
		flex: none;
		gap: var(--gl-space-6);
		align-items: center;
		justify-content: center;
		padding: var(--gl-space-8) var(--gl-space-12);
		border-top: var(--gl-border-width) solid var(--gl-metadata-bar-border, var(--vscode-widget-border));
	}

	.review-footer__copy gl-button {
		--button-padding-inline: 0.6rem;
	}

	/* Toggle-on treatment for the Follow-Up disclosure — VS Code's option-toggle tokens keep it
	   legible across themes; state is driven by the same aria-expanded that screen readers hear. */
	.review-footer__followup[aria-expanded='true'] {
		--button-background: var(--vscode-inputOption-activeBackground);
		--button-foreground: var(--vscode-inputOption-activeForeground);
		--button-hover-background: var(--vscode-inputOption-activeBackground);
		--button-border: var(--vscode-inputOption-activeBorder);
	}

	.review-footer__followup-chevron {
		transition: transform 0.15s ease-in-out;
	}

	.review-footer__followup[aria-expanded='true'] .review-footer__followup-chevron {
		transform: rotate(180deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.review-footer__followup-chevron {
			transition: none;
		}
	}

	/* Review results */

	/* Checklist (top) over the AI run or its findings (bottom), while a run is in flight or answered */
	.review-split {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		--gl-split-panel-divider-width: 4px;
	}

	.review-split__files,
	.review-split__ai {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	/* A pane's content starts where its header's title does, with the chevron hanging to the left of
	   both — the title sits past the header's padding, the chevron and the gap; the content's own column
	   (the check-all box, the overview, the focus areas) is already --gl-space-12 in */
	.review-split {
		--review-pane-title-inset: calc(var(--gl-space-2) + 16px + var(--gl-space-4));
	}

	.review-split__body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		padding-left: calc(var(--review-pane-title-inset) - var(--gl-space-12));
	}

	.review-split__body[hidden] {
		display: none;
	}

	/* Inside a pane the plan's document column starts on that same edge too (the group headings' chevron
	   sits 2px in) */
	.review-split__body .scope-files__tree--flow {
		--review-document-inset: calc(var(--gl-space-12) + var(--gl-space-2));
	}

	/* A folded pane is its header alone: its track sizes to it, the open pane takes the rest, and the
	   divider rests. These declarations come from outside the split's shadow root, so they win over its
	   own :host track sizing. */
	.review-split--folded {
		--gl-split-panel-divider-width: 0px;
	}

	.review-split--folded::part(divider) {
		visibility: hidden;
	}

	.review-split--folded-files {
		grid-template-rows: auto 0 minmax(0, 1fr);
	}

	.review-split--folded-findings {
		grid-template-rows: minmax(0, 1fr) 0 auto;
	}

	.review-split--folded-both {
		grid-template-rows: auto 0 auto;
		align-content: start;
	}

	.review-split--folded-files .review-split__files,
	.review-split--folded-findings .review-split__ai,
	.review-split--folded-both .review-split__files,
	.review-split--folded-both .review-split__ai {
		height: auto;
	}

	/* VS Code's view-pane header: a slim, uppercase bar that folds its pane */
	.review-pane-header {
		display: flex;
		flex: none;
		gap: var(--gl-space-4);
		align-items: center;
		width: 100%;
		/* Tall enough that its title sits as far below the divider as the checklist header's does */
		height: 3rem;
		padding: 0 var(--gl-space-8) 0 var(--gl-space-2);
		font-family: inherit;
		font-size: var(--gl-font-sm);
		font-weight: 700;
		color: var(--vscode-sideBarSectionHeader-foreground, inherit);
		text-align: left;
		text-transform: uppercase;
		cursor: pointer;
		background: var(--vscode-sideBarSectionHeader-background, transparent);
		border: none;
		border-top: var(--gl-border-width) solid var(--vscode-sideBarSectionHeader-border, transparent);
	}

	.review-pane-header:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	.review-pane-header__title {
		flex: none;
	}

	.review-pane-header__actions {
		display: inline-flex;
		flex: none;
		margin-left: auto;
		text-transform: none;
	}

	/* The checklist's header is the reading strip: the strip's own type and its steps, at the pane header's
	   edges — chevron, then the text where every pane's title starts */
	.review-pane-header--checklist {
		height: auto;
		min-height: 2.2rem;
		padding-block: var(--gl-space-4);
		font-size: var(--gl-font-base);
		font-weight: 400;
		color: var(--vscode-foreground);
		text-transform: none;
	}

	.review-pane-header--checklist .review-walk__body {
		flex: 1 1 auto;
		min-width: 0;
	}

	.review-pane-header--checklist .review-walk__actions {
		margin-left: var(--gl-space-4);
	}

	.review-walk__title > .review-pane-header__description {
		margin-left: 2em;
	}

	/* Folded, the file being read moves next to its steps: the title keeps its width, the path takes
	   what is left and gives way from its start, so the file's name stays readable beside the buttons */
	.review-pane-header--collapsed .review-walk__body {
		flex: 0 1 auto;
	}

	.review-pane-header__file {
		flex: 1 1 0;
		min-width: 0;
		margin-left: 2em;
		overflow: hidden;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		text-align: right;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
	}

	.review-pane-header--collapsed .review-walk__title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.review-pane-header__toggle {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		padding: 0;
		color: inherit;
		cursor: pointer;
		background: none;
		border: none;
		border-radius: var(--gl-radius-sm);
	}

	.review-pane-header__toggle:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	/* The count sits well off the title — 2em of its own size — so the two read as a name and a figure.
	   In the Findings header the flex gap is part of it; in the checklist's it is inline text */
	.review-pane-header__description {
		margin-left: calc(2em - var(--gl-space-4));
		overflow: hidden;
		font-size: var(--gl-font-sm);
		font-weight: 400;
		color: var(--vscode-descriptionForeground);
		text-overflow: ellipsis;
		text-transform: none;
		white-space: nowrap;
	}

	.review-results {
		flex: 1;
		min-height: 0;
		padding: var(--gl-space-12);
		overflow-y: auto;
	}

	/* Under an error the error's own margin is the gap */
	.review-results--after-error {
		padding-top: 0;
	}

	.review-area__header-row {
		display: flex;
		align-items: center;
		padding-right: var(--gl-space-4);
	}

	.review-area__header-row > .review-area__header {
		flex: 1;
		min-width: 0;
	}

	.review-area__actions {
		display: inline-flex;
		flex-shrink: 0;
		gap: var(--gl-space-2);
		align-items: center;
	}

	.review-finding__actions {
		display: inline-flex;
		flex-shrink: 0;
		gap: var(--gl-space-2);
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

	/* Review ending — shown once every file in the walk is viewed */
	.review-done {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-6) var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-8) var(--gl-space-10);
		margin: var(--gl-space-6) var(--gl-space-6) 0;
		border: var(--gl-border-width) solid var(--vscode-button-border);
		border-radius: var(--gl-radius-sm);
	}

	.review-done__icon {
		font-size: var(--gl-font-lg);
		color: var(--vscode-charts-green, #4ec9b0);
	}

	.review-done__body {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.review-done__title {
		font-weight: 500;
	}

	.review-done__counts {
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	.review-done__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-4);
	}

	/* The walk strip — Start Reading before a walk, the HUD during one */
	/* Both states — a file being read, plain progress — keep one box: the same border (only its color
	   changes) and a two-line body, so switching files doesn't shift everything below the strip */
	.review-walk {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-4) var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-6) var(--gl-space-10);
		margin: var(--gl-space-6) var(--gl-space-6) 0;
		border: var(--gl-border-width) solid transparent;
		border-radius: var(--gl-radius-sm);
	}

	.review-walk--reading {
		border-color: transparent;
	}

	.review-walk__hint {
		overflow: hidden;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.review-walk__body {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.review-walk__title {
		font-weight: 500;
	}

	.review-walk__file {
		overflow: hidden;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
		text-align: left;
	}

	.review-walk__actions {
		display: flex;
		gap: var(--gl-space-4);
		align-items: center;
	}

	/* The reading plan above the grouped checklist */
	/* The plan reads as one document: a title, the overview, then each group's heading, summary and files,
	   each as tall as it is — a collapsed group takes no room, a long one runs on — and the column scrolls */
	.scope-files__tree--flow {
		/* One left edge for the whole document — the strip above it, the overview, every group's heading
		   (its chevron sits 2px into the pane) and summary: the strip's own inset, margin + border + padding */
		--review-document-inset: calc(var(--gl-space-6) + var(--gl-border-width) + var(--gl-space-10));
		display: block;
		padding-left: calc(var(--review-document-inset) - var(--gl-space-2));
		overflow: auto;
	}

	.scope-files__tree--flow webview-pane-group {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: var(--gl-space-20);
		min-height: 0;
		overflow: visible;
	}

	/* The overview stands apart from the first group the way the groups stand apart from each other, and
	   starts on the document's left edge */
	.scope-files__tree--flow .review-orient {
		padding: var(--gl-space-6) 0 var(--gl-space-6) var(--gl-space-2);
		margin: var(--gl-space-6) 0 var(--gl-space-12);
	}

	.review-orient {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-4) var(--gl-space-8);
		align-items: flex-start;
		padding: var(--gl-space-6) var(--gl-space-10);
		margin: var(--gl-space-6) var(--gl-space-6) 0;
	}

	.review-orient__body {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.review-orient__title {
		font-weight: 500;
	}

	.review-orient__overview,
	.review-orient__group-summary {
		margin: var(--gl-space-2) 0 0;
		font-size: var(--gl-font-sm);
		line-height: 1.4;
		color: var(--vscode-descriptionForeground);
	}

	.review-orient__group-summary {
		padding: 0 var(--gl-space-10) var(--gl-space-8) var(--gl-space-2);
	}

	.review-orient__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gl-space-4);
	}

	.review-orient__error {
		padding: var(--gl-space-4) var(--gl-space-8);
		font-size: var(--gl-font-sm);
		color: var(--vscode-errorForeground);
	}

	/* One-click scopes over the scope picker */
	.scope-presets {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		gap: var(--gl-space-4);
		margin-bottom: var(--gl-space-6);
	}

	.scope-preset {
		padding: var(--gl-space-2) var(--gl-space-6);
		font: inherit;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		appearance: none;
		cursor: pointer;
		background: none;
		border: var(--gl-border-width) solid var(--vscode-widget-border, var(--vscode-editorWidget-border));
		border-radius: var(--gl-radius-sm);
	}

	.scope-preset:hover {
		color: var(--vscode-foreground);
		background: var(--vscode-toolbar-hoverBackground);
	}

	.scope-preset[aria-pressed='true'] {
		color: var(--vscode-button-foreground, var(--vscode-foreground));
		background: var(--vscode-button-background);
		border-color: var(--vscode-button-background);
	}

	.scope-preset:focus-visible {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: 1px;
	}

	/* The deep review's status strip */
	/* Sits on top of the footer, with the actions it belongs beside */
	.review-deep {
		display: flex;
		flex: none;
		gap: var(--gl-space-6);
		align-items: center;
		justify-content: center;
		padding: var(--gl-space-4) var(--gl-space-12) 0;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
		border-top: var(--gl-border-width) solid var(--gl-metadata-bar-border, var(--vscode-widget-border));
	}

	.review-deep + .review-footer,
	.review-deep + .review-input-row {
		border-top: none;
	}

	.review-deep__text {
		flex: 1 1 auto;
	}

	/* The author's name ("Agent", as in the threads and notes), set in capitals like the severity badge. */
	.review-finding__source {
		padding: 0 var(--gl-space-3);
		font-size: var(--gl-font-sm);
		text-transform: uppercase;
		color: var(--vscode-descriptionForeground);
		border: var(--gl-border-width) solid var(--vscode-descriptionForeground);
		border-radius: var(--gl-radius-sm);
	}

	.review-finding--closed {
		opacity: 0.7;
	}

	.review-finding__state {
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	/* Same color as the checklist's "changed since viewed" */
	.review-finding__stale,
	.review-area__stale {
		flex-shrink: 0;
		font-size: var(--gl-font-sm);
		color: var(--vscode-gitDecoration-modifiedResourceForeground);
	}

	/* Foreground extras layered on the shared .panel-loading-stage__foreground base — the in-flight
	   review centers the spinner + Cancel chip as a vertical column so the spinner stays anchored. */
	.review-loading-wrap {
		gap: var(--gl-space-10);
		align-items: center;
	}

	.review-cancel {
		margin-bottom: var(--gl-space-12);
	}

	/* Review overview */

	.review-overview {
		padding: var(--gl-space-8);
		margin-bottom: var(--gl-space-8);
		line-height: 1.5;
		border: var(--gl-border-width) solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
		border-radius: var(--gl-radius-sm);
	}

	.review-overview__text {
		color: var(--vscode-foreground);
		overflow-wrap: anywhere;
	}

	.review-overview__hint {
		display: block;
		margin-top: var(--gl-space-6);
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground);
	}

	/* Review clean */

	.review-clean {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		padding: 1.5rem 1rem;
		font-weight: 500;
		color: var(--vscode-charts-green, #4ec9b0);
	}

	/* Review areas */

	.review-areas__header-row {
		display: flex;
		gap: var(--gl-space-4);
		align-items: center;
		padding: var(--gl-space-4) 0;
	}

	.review-areas__header {
		flex: 1 1 auto;
		min-width: 0;
		font-size: var(--gl-font-base);
		font-weight: var(--gl-font-weight-regular);
		color: var(--vscode-foreground);
		text-transform: uppercase;
	}

	.review-areas__actions {
		display: inline-flex;
		flex-shrink: 0;
		gap: var(--gl-space-2);
		align-items: center;
	}

	.review-area {
		margin-bottom: var(--gl-space-6);
		overflow: hidden;
		border: var(--gl-border-width) solid var(--vscode-panel-border, var(--vscode-widget-border, transparent));
		border-radius: var(--gl-radius-sm);
	}

	.review-area__header {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		width: 100%;
		padding: var(--gl-space-6) var(--gl-space-8);
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
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
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
		padding: 0 var(--gl-space-8) var(--gl-space-8);
	}

	.review-area__rationale {
		margin-bottom: var(--gl-space-6);
		font-size: var(--gl-font-base);
		line-height: 1.4;
		color: var(--vscode-descriptionForeground);
		overflow-wrap: anywhere;
	}

	.review-area__files {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-2);
		margin-bottom: var(--gl-space-6);
	}

	.review-area__file-link {
		display: flex;
		gap: var(--gl-space-4);
		align-items: center;
		padding: var(--gl-space-2) var(--gl-space-4);
		font-family: var(--vscode-editor-font-family);
		font-size: var(--gl-font-base);
		color: var(--vscode-textLink-foreground);
		text-align: left;
		cursor: pointer;
		background: transparent;
		border: none;
		border-radius: var(--gl-radius-xs);
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
		gap: var(--gl-space-4);
		align-items: center;
		padding: var(--gl-space-4) var(--gl-space-8);
		font-family: var(--vscode-font-family);
		font-size: var(--gl-font-base);
		color: var(--vscode-button-foreground);
		cursor: pointer;
		background: var(--vscode-button-background);
		border: none;
		border-radius: var(--gl-radius-sm);
	}

	.review-area__analyze-btn:hover {
		background: var(--vscode-button-hoverBackground);
	}

	.review-area__analyze-btn:focus-visible {
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: 0.1rem;
	}

	.review-area__loading,
	.review-area__error,
	.review-area__clean {
		display: flex;
		gap: var(--gl-space-4);
		align-items: center;
		padding: var(--gl-space-6);
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
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: 0.1rem;
		border-radius: var(--gl-radius-xs);
	}

	/* Review findings */

	.review-findings {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-6);
		margin-top: var(--gl-space-6);
	}

	.review-finding {
		/* Flex column so the .review-finding__location <button> (display: flex) becomes a flex
		   item with align-items: stretch — gives it a constrained cross-axis width so its
		   shrinkable text child actually ellipsizes instead of pushing the button past the card
		   edge at narrow widths. Mirrors the .review-area__files → .review-area__file-link
		   pattern above. */
		display: flex;
		flex-direction: column;
		padding: var(--gl-space-6) var(--gl-space-8);
		background: var(--vscode-editor-inactiveSelectionBackground, rgb(255 255 255 / 4%));
		border-left: 3px solid transparent;
		border-radius: var(--gl-radius-sm);
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

	/* The reader's own comment — no severity to color it by */
	.review-finding[data-severity='comment'] {
		border-left-color: var(--vscode-descriptionForeground);
	}

	.review-finding__header {
		display: flex;
		gap: 0.5rem;

		/* baseline (not center) — the title wraps to multiple lines; with center alignment the
		   badge floats up to the visual middle of the whole title block and reads as
		   misaligned. Baseline locks the badge's text baseline to the title's first-line
		   baseline so they look like they sit on the same line of text. */
		align-items: baseline;
		margin-bottom: var(--gl-space-4);
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
		border-radius: var(--gl-radius-xs);
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

	.review-finding__title--reader {
		color: var(--vscode-descriptionForeground);
	}

	.review-finding__description {
		margin-bottom: var(--gl-space-4);
		font-size: var(--gl-font-base);
		line-height: 1.4;
		color: var(--vscode-descriptionForeground);
		overflow-wrap: anywhere;
	}

	/* What was said about the finding after the fact: a quiet column under the description, each
	   note led by who said it, so the finding's own text stays the thing that is read first */
	.review-finding__notes {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		margin-bottom: var(--gl-space-6);
		padding-left: var(--gl-space-8);
		border-left: 2px solid color-mix(in srgb, transparent 70%, var(--vscode-descriptionForeground));
	}

	.review-finding__note {
		position: relative;
		padding-right: 2.4rem;
		font-size: var(--gl-font-sm);
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	/* A note's delete shows where the pointer or focus is, so a long thread doesn't read as a column of bins */
	.review-finding__note-delete {
		position: absolute;
		top: -0.2rem;
		right: 0;
		opacity: 0;
	}

	.review-finding__note:hover .review-finding__note-delete,
	.review-finding__note:focus-within .review-finding__note-delete {
		opacity: 1;
	}

	.review-finding__note-author {
		margin-right: var(--gl-space-4);
		font-weight: 600;
		color: var(--vscode-descriptionForeground);
	}

	.review-finding__reply {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
	}

	.review-finding__reply-input {
		flex: 1 1 auto;
		min-width: 0;
		padding: var(--gl-space-4) var(--gl-space-6);
		font-family: inherit;
		font-size: var(--gl-font-sm);
		color: var(--vscode-input-foreground);
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: var(--gl-radius-sm);
	}

	.review-finding__reply-input:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
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
		padding: var(--gl-space-4);
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
		outline: var(--gl-border-width) solid var(--vscode-focusBorder);
		outline-offset: -0.1rem;
		border-radius: var(--gl-radius-xs);
	}

	.review-areas {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-6);
	}

	webview-pane [slot='title'] {
		display: inline-flex;
		gap: var(--gl-space-4);
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
