import { css } from 'lit';

export const titleBarStyles = css`
	.titlebar {
		background: var(--titlebar-bg);
		color: var(--titlebar-fg);
		padding: 0.6rem 0.8rem;
		font-size: 1.3rem;
		flex-wrap: wrap;
	}

	.titlebar,
	.titlebar__row,
	.titlebar__group {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.titlebar,
	.titlebar__row {
		justify-content: space-between;
	}

	.titlebar > *,
	.titlebar__row > *,
	.titlebar__group > * {
		margin: 0;
	}

	.titlebar__row {
		flex: 0 0 100%;
	}
	.titlebar--wrap {
		display: grid;
		grid-auto-flow: column;
		justify-content: start;
		grid-template-columns: minmax(min-content, 1fr) min-content;
	}

	.titlebar__group {
		flex: auto 1 1;
	}

	.titlebar__row--wrap .titlebar__group {
		white-space: nowrap;
	}

	.titlebar gl-feature-badge {
		color: var(--color-foreground);
	}
`;
