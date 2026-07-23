import { css } from 'lit';

export const newIndicatorStyles = css`
	/* Layout-transparent inline-grid stack: the slotted control and the dot share one grid cell so the dot never affects layout. */
	:host {
		display: inline-grid;
		--gl-indicator-size: 0.6rem;
		--gl-indicator-pulse-color: var(--gl-indicator-color, var(--vscode-activityBarBadge-background));
	}

	slot {
		display: block;
		grid-area: 1 / 1;
		min-width: 0;
	}

	.dot {
		z-index: 1;
		grid-area: 1 / 1;
		align-self: start;
		justify-self: end;
		width: var(--gl-indicator-size);
		aspect-ratio: 1;
		pointer-events: none;
		background-color: var(--gl-indicator-color, var(--vscode-activityBarBadge-background));
		border-radius: 50%;
		/* Corner overhang; consumers set --gl-new-indicator-overhang: 0% to keep the dot inside tight/zero-gap boxes */
		transform: translate(var(--gl-new-indicator-overhang, 30%), calc(-1 * var(--gl-new-indicator-overhang, 30%)));
	}
`;
