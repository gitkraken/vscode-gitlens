import { css } from 'lit';
import { focusOutline } from '../../../shared/components/styles/lit/a11y.css.js';

export const chipStyles = css`
	:host {
		display: flex;
	}

	.chip {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		padding: 0.2rem 0.4rem;
		cursor: pointer;
		border-radius: 0.3rem;
	}

	.chip:focus-visible {
		${focusOutline}
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-bottom: 0.4rem;
	}

	.header {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		width: 100%;
		padding-bottom: 0.4rem;
	}

	.header__actions {
		display: flex;
		flex: none;
		flex-direction: row;
		gap: 0.2rem;
		align-items: center;
		justify-content: center;
	}

	.header__title {
		flex: 1;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.7;
		white-space: nowrap;
	}
`;
