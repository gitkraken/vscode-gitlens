import { css } from 'lit';

/** Rebase webview layout and global styles */
export const rebaseStyles = css`
	/* ==========================================================================
	   CSS Custom Properties (Theme Variables)
	   ========================================================================== */

	:host {
		/* Layout & Typography */
		--gk-avatar-size: 2.2rem;
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
		background-color: var(--color-background);
		color: var(--color-foreground);
		font-size: var(--font-size);
		line-height: 1.4;
		overflow: hidden;
		min-width: 0;
	}

	:focus,
	:focus-within {
		outline-color: var(--focus-color);
	}

	/* Avatar background (used by gl-avatar-list component) */
	:host-context(.vscode-dark),
	:host-context(.vscode-high-contrast:not(.vscode-high-contrast-light)) {
		--avatar-bg: var(--color-background--lighten-30);
	}
	:host-context(.vscode-light) {
		--avatar-bg: var(--color-background--darken-30);
	}
	:host-context(.vscode-high-contrast-light) {
		--avatar-bg: var(--color-foreground--50);
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
		font-size: 2.2rem;
		font-weight: 200;
		line-height: normal;
		margin: 1em 0 0.3em 0;
		white-space: nowrap;
	}

	h4 {
		font-size: 1.4rem;
		font-weight: 200;
		line-height: normal;
		margin: 1em 0 0.3em 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/* ==========================================================================
	   Icons
	   ========================================================================== */

	.icon--branch::before {
		content: '\\ea68';
		font-family: codicon;
		font-size: 1.2rem;
		position: relative;
		top: 2px;
		margin: 0 3px;
	}

	.icon--commit::before {
		content: '\\eafc';
		font-family: codicon;
		font-size: 1.2rem;
		position: relative;
		top: 2px;
		margin: 0 1px 0 3px;
	}

	.mr-1 {
		margin-right: 0.4rem;
	}

	/* ==========================================================================
	   Layout (Grid Container)
	   ========================================================================== */

	.container {
		display: grid;
		grid-template-areas:
			'header'
			'banner'
			'entries'
			'footer';
		grid-template-rows: auto auto 1fr auto;
		grid-template-columns: minmax(0, 1fr);
		height: 100vh;
		min-width: 0;
	}

	/* ==========================================================================
	   Banners (Read-only)
	   ========================================================================== */

	.read-only-banner {
		grid-area: banner;
		margin: 0.5rem 1rem;
		margin-block-end: 0.5rem;

		/* Warning-style colors */
		--gl-banner-primary-background: var(--vscode-inputValidation-warningBackground, rgba(205, 145, 0, 0.15));
		--gl-banner-secondary-background: var(--vscode-inputValidation-warningBackground, rgba(205, 145, 0, 0.15));
		--gl-banner-text-color: var(--vscode-inputValidation-warningForeground, inherit);
		--gl-banner-primary-emphasis-background: var(--vscode-inputValidation-warningBorder, #cca700);
	}

	/* ==========================================================================
	   Header
	   ========================================================================== */

	header {
		grid-area: header;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		min-width: 0;
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);

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
		align-items: center;
		gap: 0.5rem 1rem;
		min-width: 0;
	}

	.header-info {
		flex: 1 1 0;
		min-width: 0;
		color: var(--color-foreground--65);
		margin-left: 1rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding-block: 0.4rem;
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
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 1.6rem;
		white-space: nowrap;
	}

	.header-toggle {
		flex: 0 0 auto;
		white-space: nowrap;
	}

	.header-title {
		flex: 0 1 auto;
		font-size: 1.6rem;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	/* Rebase banner */
	.rebase-banner {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background-color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor, #c4a000);
		color: #000;
		padding: 0.3rem 0.6rem;
		border-radius: 0.3rem;

		&.has-conflicts {
			background-color: var(
				--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor,
				#cc6600
			);
			color: #fff;
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
			font-weight: 600;
			margin-left: auto;
		}

		.rebase-remaining {
			flex: none;
			opacity: 0.85;
		}

		.rebase-action-link {
			flex: none;
			color: inherit;
			text-decoration: underline dotted;
			text-underline-offset: 0.3rem;
			cursor: pointer;
			opacity: 0.9;
			margin-left: 1rem;

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
		grid-area: entries;
		display: block;
		height: 100%;
		min-height: 0;
		overflow-x: hidden !important;
		overflow-y: visible;
		outline: none;
		margin-inline: 1rem;
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
		grid-area: entries;
		display: flex;
		justify-content: center;
		color: var(--color-foreground--85);
		margin-top: 3rem;
		font-style: italic;
	}

	gl-rebase-entry.dragging {
		opacity: 0.4;
	}

	gl-rebase-entry.drag-over::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background-color: var(--vscode-focusBorder);
		z-index: 10;
		pointer-events: none;
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
	   Footer
	   ========================================================================== */

	footer {
		grid-area: footer;
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
		background: var(--color-background);
		z-index: 1;
		min-width: 0;
	}

	.shortcuts {
		flex: 1 1 0;
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 0.5rem 1rem;
		overflow: hidden;
		min-width: 0;

		> code-icon {
			flex: 0 0 auto;
		}
	}

	.shortcut {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: baseline;
		color: var(--color-foreground--65);
		gap: 0.2rem;
		white-space: nowrap;

		kbd {
			color: var(--vscode-keybindingLabel-foreground);
			display: inline-block;
			font-family: var(--vscode-font-family);
			font-weight: 600;
			line-height: 1.4;
			vertical-align: middle;

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
		align-items: center;
		gap: 1rem;
		flex-shrink: 0;
	}

	gl-rebase-conflict-indicator {
		margin-right: auto;
		margin-left: 1.6rem;
	}

	gl-button .button-shortcut {
		display: block;
		margin-top: 0.2rem;
		font-weight: 200;
		font-size: 0.9rem;
		opacity: 0.6;
		text-transform: none;
		letter-spacing: normal;
	}

	gl-button:hover .button-shortcut {
		opacity: 1;
	}
`;
