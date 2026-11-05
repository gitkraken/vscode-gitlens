import { css } from 'lit';

/** Rebase webview layout and global styles */
export const rebaseStyles = css`
	.clickable {
		cursor: pointer;
	}

	/* ==========================================================================
	   CSS Custom Properties (Theme Variables)
	   ========================================================================== */

	:host {
		/* Layout & Typography */
		--gl-avatar-size: 2.2rem;
		--font-family: var(--vscode-font-family);
		--font-size: var(--vscode-font-size);

		/* Host element styles */
		display: block;
		min-width: 0;
		overflow: hidden;
		font-size: var(--font-size);
		line-height: 1.4;
		color: var(--color-foreground);
		background-color: var(--gl-color-surface-base);
	}

	:focus,
	:focus-within {
		outline-color: var(--gl-color-border-focus);
	}

	/* ==========================================================================
	   Base Element Styles
	   ========================================================================== */

	a {
		color: var(--gl-color-action-link-fg);
		text-decoration: none;
	}

	a:focus {
		outline: var(--gl-border-width) solid var(--gl-color-border-focus);
		outline-offset: 2px;
	}

	h2 {
		margin: 1em 0 0.3em;
		font-size: 2.2rem;
		font-weight: 200;
		line-height: normal;
		white-space: nowrap;
	}

	h4 {
		margin: 1em 0 0.3em;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--gl-font-lg);
		font-weight: 200;
		line-height: normal;
		white-space: nowrap;
	}

	ul {
		padding: 0;
		margin: 0;
		list-style: none;
	}

	/* ==========================================================================
	   Icons
	   ========================================================================== */

	.icon--branch::before {
		position: relative;
		top: 2px;
		margin: 0 3px;
		font-family: codicon;
		font-size: var(--gl-font-md);
		content: '\\ea68';
	}

	.icon--commit::before {
		position: relative;
		top: 2px;
		margin: 0 1px 0 3px;
		font-family: codicon;
		font-size: var(--gl-font-md);
		content: '\\eafc';
	}

	.mr-1 {
		margin-right: var(--gl-space-4);
	}

	/* ==========================================================================
	   Layout (Grid Container)
	   ========================================================================== */

	.container {
		box-sizing: border-box;
		display: grid;
		grid-template:
			'header' auto
			'banner' auto
			'content' minmax(0, 1fr)
			'footer' auto
			/ minmax(0, 1fr);
		min-width: 0;
		height: 100vh;
		padding: 0.5rem;
	}

	.content {
		display: flex;
		flex-direction: column;
		grid-area: content;
		min-height: 0;
	}

	/* ==========================================================================
	   Banners (Preserves Merges)
	   ========================================================================== */

	.banners {
		display: flex;
		flex-direction: column;
		grid-area: banner;
	}

	.preserves-merges-banner,
	.close-warning-banner {
		margin: 0.5rem 1rem;
		margin-block-end: 0.5rem;

		/* Info-style colors */
		--gl-banner-primary-background: var(--gl-color-feedback-info-bg);
		--gl-banner-secondary-background: var(--gl-color-feedback-info-bg);
		--gl-banner-text-color: var(--gl-color-feedback-info-fg);
		--gl-banner-primary-emphasis-background: var(--gl-color-feedback-info-border);
	}

	/* ==========================================================================
	   Header
	   ========================================================================== */

	header {
		display: flex;
		flex-direction: column;
		grid-area: header;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.5rem 1rem;

		gl-checkbox {
			margin-block: 0;
		}

		gl-commit-sha::part(label) {
			font-weight: bold;
		}
	}

	.header__row {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.5rem 1rem;
		align-items: center;
		min-width: 0;
	}

	.header-info {
		flex: 1 1 0;
		min-width: 0;
		padding-block: var(--gl-space-4);
		margin-left: var(--gl-space-10);
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--vscode-descriptionForeground);
		white-space: nowrap;
	}

	.header-info gl-branch-name,
	.header-info gl-commit-sha {
		vertical-align: baseline;
	}

	.header-info gl-tooltip {
		display: inline;
		min-width: 0;
	}

	.header-count {
		margin-left: var(--gl-space-10);
		white-space: nowrap;
	}

	.header-onto {
		display: inline;
		white-space: nowrap;
	}

	.header-actions {
		display: flex;
		flex: 0 0 auto;
		gap: var(--gl-space-16);
		align-items: center;
		white-space: nowrap;
	}

	.header-toggle {
		flex: 0 0 auto;
		white-space: nowrap;
	}

	.header-title {
		flex: 0 1 auto;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 1.6rem;
		white-space: nowrap;
	}

	/* Rebase banner */
	.rebase-banner {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		padding: 0.3rem 0.6rem;
		color: #000;
		background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor, #c4a000);
		border-radius: var(--gl-radius-sm);

		&.has-conflicts {
			color: #fff;
			background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor, #c60);
		}

		code-icon {
			flex: none;
		}

		.rebase-status {
			flex: none;
		}

		gl-tooltip {
			flex: none;
		}

		.rebase-progress {
			flex: none;
			margin-left: auto;
			font-weight: var(--gl-font-weight-semibold);
		}

		.rebase-remaining {
			flex: none;
			opacity: 0.85;
		}

		.rebase-action-link {
			flex: none;
			margin-left: var(--gl-space-10);
			color: inherit;
			text-decoration: underline dotted;
			text-underline-offset: 0.3rem;
			cursor: pointer;
			opacity: 0.9;

			&:hover {
				text-decoration: none;
				opacity: 1;
			}
		}
	}

	/* ==========================================================================
	   Entries
	   ========================================================================== */

	/* Non-scrolling frame: the scrollable base style recolors the virtualizer's own border on hover/focus,
	   so the divider borders live on this wrapper instead */
	.entries-frame {
		box-sizing: border-box;
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		min-height: 0;
		margin: 0.5rem 1rem;
		border-top: var(--gl-border-width) solid var(--gl-color-divider-base);
		border-bottom: var(--gl-border-width) solid var(--gl-color-divider-base);
	}

	.entries {
		box-sizing: border-box;
		display: block;
		flex: 1 1 0;
		/* lit-virtualizer sets an inline min-height: 150px, which overflows (and clips) a shorter conflict split pane */
		min-height: 0 !important;
		overflow-x: hidden !important;
		overflow-y: auto;
		outline: none;

		--current-entry-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor, #c4a000);

		/* Override current entry color when there are conflicts */
		&.has-conflicts {
			--current-entry-color: var(
				--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor,
				#c74e39
			);
		}
	}

	.entries:focus-within {
		outline: none;
	}

	.entries-empty {
		display: flex;
		flex: 1 1 0;
		justify-content: center;
		margin-top: 3rem;
		font-style: italic;
		color: var(--vscode-descriptionForeground);
	}

	gl-rebase-entry.dragging {
		opacity: 0.4;
	}

	gl-rebase-entry.drag-over::before {
		position: absolute;
		top: 0;
		right: 0;
		left: 0;
		z-index: 10;
		height: 2px;
		pointer-events: none;
		content: '';
		background-color: var(--vscode-focusBorder);
	}

	/* When hovering on bottom half of entry, show indicator at bottom */
	gl-rebase-entry.drag-over-bottom::before {
		top: auto;
		bottom: 0;
	}

	/* Base entry indicator position depends on mode:
	   - Ascending (base at top): indicator at bottom (insert after base)
	   - Descending (base at bottom): indicator at top (insert before base) */
	.entries.ascending gl-rebase-entry[isbase].drag-over::before {
		top: auto;
		bottom: 0;
	}

	/* ==========================================================================
	   Conflict Split Panel
	   ========================================================================== */

	.entries-panel {
		display: flex;
		flex-direction: column;
		overflow: hidden;

		> .entries-frame {
			border-bottom: none;
		}
	}

	.conflict-split {
		flex: 1 1 0;
		min-height: 0;

		&::part(divider) {
			background-image: linear-gradient(var(--gl-color-divider-base), var(--gl-color-divider-base));
			background-repeat: no-repeat;
			background-position: center;
			background-size: 100% 1px;
			transition: background-color var(--gl-duration-x-fast) var(--gl-ease-out);
		}

		&::part(divider):hover,
		&[dragging]::part(divider) {
			background-image: linear-gradient(
				var(--vscode-sash-hoverBorder, var(--vscode-focusBorder)),
				var(--vscode-sash-hoverBorder, var(--vscode-focusBorder))
			);
			background-size: 100% 100%;
			transition: background-color var(--gl-duration-x-fast) var(--gl-ease-out) 0.2s;
		}
	}

	.conflict-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 0 var(--gl-space-10);
		overflow: hidden;
	}

	.conflict-panel__header {
		display: flex;
		flex: none;
		gap: var(--gl-space-4);
		align-items: center;
		padding: 0.5rem 0;
		font-weight: var(--gl-font-weight-semibold);
		color: var(--gl-color-feedback-warning-quiet-fg);
	}

	.conflict-panel__header > span {
		flex: 1;
	}

	.conflict-panel__list {
		flex: 1;
		min-height: 0;
		--gl-decoration-before-font-size: 0.8em;
		--gl-decoration-before-opacity: 0.7;
	}

	/* ==========================================================================
	   Footer
	   ========================================================================== */

	footer {
		z-index: 1;
		display: flex;
		grid-area: footer;
		gap: var(--gl-space-10);
		align-items: center;
		justify-content: flex-end;
		min-width: 0;
		padding: 0.5rem 1rem;
		background: var(--gl-color-surface-base);
	}

	.shortcuts {
		display: flex;
		flex: 1 1 0;
		flex-wrap: nowrap;
		gap: 0.5rem 1rem;
		align-items: center;
		min-width: 0;
		overflow: hidden;

		> code-icon {
			flex: 0 0 auto;
		}
	}

	.shortcut {
		display: inline-flex;
		flex: 0 0 auto;
		gap: var(--gl-space-2);
		align-items: baseline;
		color: var(--vscode-descriptionForeground);
		white-space: nowrap;

		kbd {
			display: inline-block;
			font-family: var(--vscode-font-family);
			font-weight: var(--gl-font-weight-semibold);
			line-height: 1.4;
			vertical-align: middle;
			color: var(--vscode-keybindingLabel-foreground);

			&.word {
				text-decoration: underline;
				text-underline-offset: 0.3rem;
			}
		}

		.label {
			margin-left: 0.3rem;
		}
	}

	.actions {
		display: flex;
		flex-shrink: 0;
		gap: var(--gl-space-10);
		align-items: center;
	}

	/* Both halves are secondary-appearance buttons here, so the seam derives from the secondary
	   foreground instead of the shared module's primary-foreground default. */
	.split-btn {
		--gl-split-btn-seam: color-mix(in srgb, transparent 72%, var(--gl-color-action-secondary-fg));
	}

	gl-rebase-conflict-indicator {
		margin-right: auto;
		margin-left: var(--gl-space-16);
	}

	.conflict-loading {
		display: inline-flex;
		align-items: center;
		margin-left: 0.5rem;
		color: var(--vscode-foreground);
		opacity: 0.7;
	}

	.conflict-summary {
		display: inline-flex;
		gap: var(--gl-space-4);
		align-items: center;
		padding: var(--gl-space-2) var(--gl-space-6);
		margin-left: 0.5rem;
		font-size: var(--gl-font-sm);
		font-weight: 500;
		border-radius: var(--gl-radius-sm);

		&.warning {
			color: var(--gl-color-feedback-warning-fg);
			background-color: var(--gl-color-feedback-warning-bg);
			border: var(--gl-border-width) solid var(--gl-color-feedback-warning-border);
		}
	}

	gl-button .button-shortcut {
		display: block;
		margin-top: var(--gl-space-2);
		font-size: 0.9rem;
		font-weight: 200;
		text-transform: none;
		letter-spacing: normal;
		opacity: 0.6;
	}

	gl-button:hover .button-shortcut {
		opacity: 1;
	}

	/* ==========================================================================
	   Density: Comfortable
	   ========================================================================== */

	.container[data-density='comfortable'] {
		--gl-rebase-entry-padding-block: 0.5rem;
		--gl-rebase-entry-graph-height: 29px;
		--gl-rebase-entry-graph-offset: -0.5rem;
	}
`;
