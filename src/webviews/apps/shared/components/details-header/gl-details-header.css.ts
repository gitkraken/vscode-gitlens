import { css } from 'lit';

export const detailsHeaderStyles = css`
	:host {
		display: contents;
	}

	.details-header {
		display: flex;
		flex-direction: column;
		flex: none;
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.details-header__row {
		display: flex;
		align-items: flex-start;
		padding: 0.7rem 1.2rem 0.5rem 1.2rem;
		gap: 0.6rem;
	}

	.details-header__content {
		flex: 1;
		min-width: 0;
	}

	.details-header__actions {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
	}
`;
