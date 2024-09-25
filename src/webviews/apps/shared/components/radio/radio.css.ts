import { css } from 'lit';

export const radioStyles = css`
	:host {
		--design-unit: 4;
		--control-corner-radius: 50%;
		--control-border-width: 1px;
		--control-size: calc(var(--design-unit) * 4px + 2px);
		--label-spacing: calc(var(--design-unit) * 2px + 2px);
	}
`;
