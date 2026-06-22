import { css } from 'lit';

export const sliderStyles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: 1.2rem;
	}

	wa-slider {
		--track-size: 0.4rem;
		--thumb-width: 1.4rem;
		--thumb-height: 1.4rem;

		flex: 1;
		min-width: 12rem;
	}

	wa-slider::part(track) {
		background-color: color-mix(in srgb, var(--color-foreground) 20%, transparent);
		border: 1px solid var(--vscode-contrastBorder, transparent);
	}

	wa-slider::part(indicator) {
		background-color: var(--vscode-button-background);
	}

	wa-slider::part(thumb) {
		background-color: var(--vscode-button-background);
		border: 1px solid var(--vscode-contrastBorder, var(--vscode-button-background));
		box-shadow: 0 1px 2px var(--vscode-widget-shadow);
	}

	wa-slider:focus-within::part(thumb) {
		outline: 1px solid var(--color-focus-border);
		outline-offset: 2px;
	}

	wa-slider[disabled] {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.value {
		flex: none;
		min-width: 4.4rem;
		font-family: var(--vscode-editor-font-family);
		font-size: 1.2rem;
		color: var(--color-foreground--85);
	}

	@media (prefers-reduced-motion: reduce) {
		wa-slider::part(thumb),
		wa-slider::part(indicator) {
			transition: none;
		}
	}
`;
