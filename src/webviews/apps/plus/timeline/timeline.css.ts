import { css } from 'lit';

export const timelineBaseStyles = css`
	* {
		box-sizing: border-box;
	}

	:not(:defined) {
		visibility: hidden;
	}

	[hidden] {
		display: none !important;
	}

	/* roll into shared focus style */
	:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	a {
		text-decoration: none;

		&:hover {
			text-decoration: underline;
		}
	}

	b {
		font-weight: 600;
	}

	p {
		margin-top: 0;
	}

	ul {
		padding-left: 1.2em;
		margin-top: 0;
	}

	section,
	header {
		display: flex;
		flex-direction: column;
		padding: 0;
	}

	h2 {
		font-weight: 400;
	}

	h3 {
		margin-bottom: 0;
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-view-header-foreground);
		white-space: nowrap;
		border: none;
	}

	h4 {
		margin: 0.5rem 0 1rem;
		font-size: 1.5rem;
		font-weight: 400;
	}
`;

export const timelineStyles = css`
	:host {
		display: block;
		height: 100vh;
		padding: 0;
		margin: 0;
		overflow: hidden;
		font-family: var(--font-family);
		font-size: var(--font-size);
		color: var(--color-view-foreground);
	}

	.container {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.timeline {
		flex: 1;
		min-height: 0;
	}

	.timeline__empty {
		padding: 0.4rem 2rem 1.3rem;
		font-size: var(--font-size);
	}

	.timeline__empty p {
		margin-top: 0;
	}

	:host-context(body[data-placement='view']) gl-feature-gate {
		background-color: var(--vscode-sideBar-background);
	}

	gl-feature-gate gl-feature-badge {
		margin-right: var(--gl-space-4);
		margin-left: var(--gl-space-4);
		vertical-align: super;
	}
`;
