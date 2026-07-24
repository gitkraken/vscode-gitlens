import { css } from 'lit';
import { focusOutline } from '../../../shared/components/styles/lit/a11y.css.js';

export const chipStyles = css`
	:host {
		display: flex;
	}

	.chip {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		padding: var(--gl-space-2) var(--gl-space-4);
		cursor: pointer;
		border-radius: var(--gl-radius-sm);
	}

	.chip:focus-visible {
		${focusOutline}
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-4);
		padding-bottom: var(--gl-space-4);
	}

	.header {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		width: 100%;
		padding-bottom: var(--gl-space-4);
	}

	.header__actions {
		display: flex;
		flex: none;
		flex-direction: row;
		gap: var(--gl-space-2);
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
