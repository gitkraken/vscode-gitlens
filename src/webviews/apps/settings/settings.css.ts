import { css } from 'lit';
import { focusableBaseStyles, focusOutline } from '../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase } from '../shared/components/styles/lit/base.css.js';

export const settingsAppStyles = [
	boxSizingBase,
	focusableBaseStyles,
	css`
		:host {
			display: block;
			height: 100vh;
			font-family: var(--vscode-font-family);
			color: var(--color-foreground);
		}

		.app {
			display: flex;
			flex-direction: column;
			height: 100%;

			/* Lets the header respond to the panel width, not the viewport */
			container: settings-app / inline-size;
		}

		.header {
			display: flex;
			flex: none;
			gap: var(--gl-space-16);
			align-items: center;
			justify-content: space-between;
			padding: 1.2rem 1.8rem;
			border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
		}

		.header__brand {
			display: flex;
			gap: 0.9rem;
			align-items: center;

			gl-icon-cube {
				--gl-icon-cube-size: 2rem;
			}
		}

		.header__title {
			margin: 0;
			font-size: 1.6rem;
			font-weight: 600;
			line-height: 1;
			white-space: nowrap;
		}

		.header__version {
			font-size: 1.05rem;
			color: var(--color-foreground--50);
			white-space: nowrap;
			text-decoration: none;
		}

		.header__version:hover,
		.header__version:focus-visible {
			color: var(--color-link-foreground);
			text-decoration: underline;
		}

		.header__search {
			position: relative;
			flex: 1;
			max-width: 42rem;
		}

		.header__search code-icon {
			position: absolute;
			top: 50%;
			left: 1rem;
			color: var(--color-foreground--50);
			pointer-events: none;
			transform: translateY(-50%);
		}

		.header__search input {
			width: 100%;
			padding: 0.7rem 0.9rem 0.7rem 3rem;
			font-family: var(--vscode-font-family);
			font-size: 1.25rem;
			color: var(--vscode-input-foreground);
			outline: none;
			background-color: var(--vscode-input-background);
			border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
			border-radius: var(--gl-input-border-radius);
		}

		.header__search input::placeholder {
			color: var(--vscode-input-placeholderForeground);
		}

		.header__search input:focus {
			${focusOutline}
		}

		.header__scope {
			display: flex;
			gap: var(--gl-space-8);
			align-items: center;
			font-size: 1.2rem;
			color: var(--color-foreground--65);
			white-space: nowrap;
		}

		/* Narrow panel: drop the search onto its own full-width line below the
   title/scope row (ordered last so the title + scope share the first row) */
		@container settings-app (max-width: 768px) {
			.header {
				flex-wrap: wrap;
			}

			.header__search {
				flex-basis: 100%;
				order: 1;
				max-width: none;
			}
		}

		.body {
			flex: 1;
			min-height: 0;
		}

		/* Initial-load gate — mirrors the two-pane layout so the real UI doesn't shift in */
		.body--loading {
			display: flex;
			overflow: hidden;
		}

		.body--loading__nav {
			flex: none;
			width: 24rem;
			padding: 1.6rem 1.4rem;
			background-color: var(--vscode-sideBar-background);
			border-right: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
		}

		.body--loading__detail {
			flex: 1;
			max-width: 64rem;
			padding: 2rem 2.6rem;
		}

		/* Bootstrap failure — persists even if the error banner is dismissed */
		.body--error {
			display: flex;
			gap: var(--gl-space-8);
			align-items: flex-start;
			padding: 2.4rem 2.6rem;
			font-size: 1.3rem;
			line-height: 1.5;
		}

		.body--error code-icon {
			flex: none;
			margin-block-start: var(--gl-space-2);
			color: var(--vscode-errorForeground);
		}

		.body--error a {
			color: var(--color-link-foreground);
		}

		.body__nav {
			background-color: var(--vscode-sideBar-background);
			border-right: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
		}

		.body__detail {
			display: flex;
			flex-direction: column;
			min-width: 0;
		}

		.body__detail gl-settings-detail {
			flex: 1;
			min-height: 0;
		}
	`,
];
