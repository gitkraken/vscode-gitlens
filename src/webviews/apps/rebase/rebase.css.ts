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

		/* Colors */
		--color-background: var(--vscode-editor-background);
		--color-foreground: var(--vscode-editor-foreground, var(--vscode-foreground));
		--color-link-foreground: var(--vscode-textLink-foreground);
		--color-focus-border: var(--vscode-focusBorder);

		/* Background variants */
		--color-background--lighten-05: color-mix(in srgb, #fff 5%, var(--color-background));
		--color-background--darken-05: color-mix(in srgb, #000 5%, var(--color-background));
		--color-background--lighten-15: color-mix(in srgb, #fff 15%, var(--color-background));
		--color-background--darken-15: color-mix(in srgb, #000 15%, var(--color-background));
		--color-background--lighten-30: color-mix(in srgb, #fff 30%, var(--color-background));
		--color-background--darken-30: color-mix(in srgb, #000 30%, var(--color-background));
		--color-background--darken-50: color-mix(in srgb, #000 50%, var(--color-background));

		/* Foreground variants */
		--color-foreground--75: color-mix(in srgb, transparent 25%, var(--color-foreground));
		--color-foreground--65: color-mix(in srgb, transparent 35%, var(--color-foreground));
		--color-foreground--50: color-mix(in srgb, transparent 50%, var(--color-foreground));
		--color-foreground--35: color-mix(in srgb, transparent 65%, var(--color-foreground));
		--color-foreground--25: color-mix(in srgb, transparent 75%, var(--color-foreground));

		/* Highlight colors */
		--color-highlight: var(--vscode-button-background, var(--vscode-button-border));
		--color-highlight--50: color-mix(in srgb, transparent 50%, var(--color-highlight));
		--color-highlight--25: color-mix(in srgb, transparent 75%, var(--color-highlight));
		--color-highlight--10: color-mix(in srgb, transparent 90%, var(--color-highlight));

		--focus-color: var(--vscode-focusBorder);

		/* Host element styles */
		display: block;
		min-width: 0;
		overflow: hidden;
		font-size: var(--font-size);
		line-height: 1.4;
		color: var(--color-foreground);
		background-color: var(--color-background);
	}

	:focus,
	:focus-within {
		outline-color: var(--focus-color);
	}

	/* ==========================================================================
	   Base Element Styles
	   ========================================================================== */

	a {
		color: var(--color-link-foreground);
		text-decoration: none;
	}

	a:focus {
		outline: 1px solid var(--color-focus-border);
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
		font-size: 1.4rem;
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
		font-size: 1.2rem;
		content: '\\ea68';
	}

	.icon--commit::before {
		position: relative;
		top: 2px;
		margin: 0 1px 0 3px;
		font-family: codicon;
		font-size: 1.2rem;
		content: '\\eafc';
	}

	.mr-1 {
		margin-right: 0.4rem;
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
		--gl-banner-primary-background: var(--vscode-inputValidation-infoBackground, rgb(0 127 212 / 15%));
		--gl-banner-secondary-background: var(--vscode-inputValidation-infoBackground, rgb(0 127 212 / 15%));
		--gl-banner-text-color: var(--vscode-inputValidation-infoForeground, inherit);
		--gl-banner-primary-emphasis-background: var(--vscode-inputValidation-infoBorder, #007fd4);
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
		padding-block: 0.4rem;
		margin-left: 1rem;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-foreground--65);
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
		margin-left: 1rem;
		white-space: nowrap;
	}

	.header-onto {
		display: inline;
		white-space: nowrap;
	}

	.header-actions {
		display: flex;
		flex: 0 0 auto;
		gap: 1.6rem;
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
		gap: 0.6rem;
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
			font-weight: 600;
		}

		.rebase-remaining {
			flex: none;
			opacity: 0.85;
		}

		.rebase-action-link {
			flex: none;
			margin-left: 1rem;
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

	.entries {
		box-sizing: border-box;
		display: block;
		flex: 1 1 0;
		min-height: 0;
		margin: 0.5rem 1rem;
		overflow-x: hidden !important;
		overflow-y: auto;
		outline: none;
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	.entries {
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
		color: var(--color-foreground--85);
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

		> .entries {
			border-bottom: none;
		}
	}

	.conflict-split {
		flex: 1 1 0;
		min-height: 0;

		&::part(divider) {
			background-image: linear-gradient(
				var(--vscode-sideBarSectionHeader-border, rgb(128 128 128 / 35%)),
				var(--vscode-sideBarSectionHeader-border, rgb(128 128 128 / 35%))
			);
			background-repeat: no-repeat;
			background-position: center;
			background-size: 100% 1px;
			transition: background-color 0.1s ease-out;
		}

		&::part(divider):hover,
		&[dragging]::part(divider) {
			background-image: linear-gradient(
				var(--vscode-sash-hoverBorder, var(--vscode-focusBorder)),
				var(--vscode-sash-hoverBorder, var(--vscode-focusBorder))
			);
			background-size: 100% 100%;
			transition: background-color 0.1s ease-out 0.2s;
		}
	}

	.conflict-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 0 1rem;
		overflow: hidden;
	}

	.conflict-panel__header {
		display: flex;
		flex: none;
		gap: 0.4rem;
		align-items: center;
		padding: 0.5rem 0;
		font-weight: 600;
		color: var(--vscode-editorWarning-foreground, #cca700);
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
		gap: 1rem;
		align-items: center;
		justify-content: flex-end;
		min-width: 0;
		padding: 0.5rem 1rem;
		background: var(--color-background);
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
		gap: 0.2rem;
		align-items: baseline;
		color: var(--color-foreground--65);
		white-space: nowrap;

		kbd {
			display: inline-block;
			font-family: var(--vscode-font-family);
			font-weight: 600;
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
		gap: 1rem;
		align-items: center;
	}

	gl-rebase-conflict-indicator {
		margin-right: auto;
		margin-left: 1.6rem;
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
		gap: 0.4rem;
		align-items: center;
		padding: 0.2rem 0.6rem;
		margin-left: 0.5rem;
		font-size: 1.1rem;
		font-weight: 500;
		border-radius: var(--gl-radius-sm);

		&.warning {
			color: var(--vscode-inputValidation-warningForeground, #cca700);
			background-color: var(--vscode-inputValidation-warningBackground, rgb(200 140 0 / 20%));
			border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700);
		}
	}

	gl-button .button-shortcut {
		display: block;
		margin-top: 0.2rem;
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
