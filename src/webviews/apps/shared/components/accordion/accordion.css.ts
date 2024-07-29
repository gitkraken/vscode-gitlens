import { css } from 'lit';

export const accordionBaseStyles = css`
	.accordion-button {
		appearance: none;
		border: var(--gk-accordion-button-border, 1px solid #111a22);
		border-radius: var(--gk-accordion-button-border-radius, 0.25rem);
		background-color: var(--gk-accordion-button-background-color, transparent);
		color: var(--gk-accordion-button-color, #111a22);
		cursor: pointer;
		display: flex;
		align-items: center;
		padding: var(--gk-accordion-button-padding, 0.5rem);
		width: var(--gk-accordion-button-width);
	}
	/* override hover only if provided; */
	@container style(--gk-accordion-button-background-color-hovered) {
		.accordion-button:hover,
		.accordion-button:focus-within {
			background-color: var(--gk-accordion-button-background-color-hovered, transparent);
		}
	}

	.accordion-button svg {
		width: var(--gk-accordion-button-chevron-size, 16px);
		height: var(--gk-accordion-button-chevron-size, 16px);
	}

	.accordion-button:not(.accordion-button--expanded) code-icon {
		transform: rotate(-90deg);
	}

	/* override outline only if provided; */
	@container style(--gk-accordion-button-focus-outline) {
		.accordion-button:focus-within,
		.accordion-button:focus-visible {
			outline: var(--gk-accordion-button-focus-outline);
		}
	}

	.chevron-down-icon {
		margin-left: auto;
		transition: all 0.25s;
		-moz-transition: all 0.25s;
		-webkit-transition: all 0.25s;
	}

	.accordion-details {
		background-color: var(--gk-accordion-details-background-color, transparent);
		border: var(--gk-accordion-details-border, none);
		color: var(--gk-accordion-details-color, #111a22);
		padding: var(--gk-accordion-details-padding, 0.5rem);
	}
`;
