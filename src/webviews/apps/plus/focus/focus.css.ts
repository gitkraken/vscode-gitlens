import { css } from 'lit';

export const webviewBaseStyles = css`
	:not(:defined) {
		visibility: hidden;
	}

	[hidden] {
		display: none !important;
	}

	:root {
		font-size: 62.5%;
		font-family: var(--font-family);
		box-sizing: border-box;
	}

	*,
	*::before,
	*::after {
		box-sizing: inherit;
	}

	body {
		font-family: var(--font-family);
		font-size: var(--font-size);
		color: var(--color-foreground);
	}

	body[data-placement='editor'] {
		background-color: var(--color-background);

		[data-placement-hidden='editor'],
		[data-placement-visible]:not([data-placement-visible='editor']) {
			display: none !important;
		}
	}

	body[data-placement='view'] {
		[data-placement-hidden='view'],
		[data-placement-visible]:not([data-placement-visible='view']) {
			display: none !important;
		}
	}

	a {
		text-decoration: none;

		&:hover {
			text-decoration: underline;
		}
	}

	a:focus,
	button:not([disabled]):focus,
	[tabindex]:not([tabindex='-1']):focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	code-icon {
		font-size: inherit;
	}

	gk-tooltip gk-menu {
		z-index: 10;
	}

	h2,
	h3,
	p {
		margin-top: 0;
	}

	h3 {
		margin-bottom: 0;
	}
`;

export const focusStyles = css`
	.alert {
		display: flex;
		flex-direction: row;
		padding: 0.8rem 1.2rem;
		background-color: var(--color-alert-neutralBackground);
		border-left: 0.3rem solid var(--color-foreground--50);
		color: var(--color-alert-foreground);
	}
	.alert code-icon {
		margin-right: 0.4rem;
		vertical-align: baseline;
	}
	.alert__content {
		font-size: 1.2rem;
		line-height: 1.2;
		text-align: left;
	}

	.tab-filter {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;
		gap: 1rem;
	}
	.tab-filter__tab {
		padding: 0.2rem 0;
		text-transform: uppercase;
		color: var(--color-foreground--65);
		border: none;
		background: none;
		text-align: center;
		font-size: 1.1rem;
		border-bottom: 0.1rem solid transparent;
		cursor: pointer;
	}
	.tab-filter__tab.is-active {
		color: var(--vscode-foreground);
		border-bottom-color: var(--color-foreground);
	}

	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.app__toolbar {
		background-color: var(--background-05);
		display: grid;
		align-items: center;
		padding: 0.2rem 2rem;
		margin-left: -2rem;
		margin-right: -2rem;
		grid-template-columns: 1fr min-content min-content;
		gap: 0.5rem;
		z-index: 101;
	}
	.app__content {
		position: relative;
		flex: 1 1 auto;
		overflow: hidden;
	}
	.app__focus {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		height: 100%;
		gap: 1.2rem;
	}
	.app__header {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
		padding-top: 1.2rem;
		z-index: 1;
	}
	.app__header-group {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.app__search {
		flex: 1;
	}
	.app__search code-icon {
		margin-right: 0.8rem;
	}
	.app__main {
		min-height: 0;
		flex: 1 1 auto;
		overflow: auto;
	}

	.preview {
		font-size: 1rem;
		font-weight: 700;
		text-transform: uppercase;
		color: var(--color-foreground);
	}

	.mine-menu {
		width: max-content;
	}
`;
