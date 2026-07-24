import { css } from 'lit';
import { srOnlyStyles } from '../styles/lit/a11y.css.js';

export const switchStyles = css`
	:host {
		display: inline-flex;
		vertical-align: middle;
	}

	/* The label-prop fallback content — names the switch without rendering a visible label */
	.sr-only {
		${srOnlyStyles}
	}

	wa-switch {
		/* Sizing knobs exposed by wa-switch */
		--width: 3.2rem;
		--height: 1.8rem;
		--thumb-size: 1.4rem;

		font-family: var(--vscode-font-family);
		font-size: inherit;
		color: var(--color-foreground);
	}

	:host([size='large']) wa-switch {
		--width: 4rem;
		--height: 2.2rem;
		--thumb-size: 1.8rem;
	}

	/* Track. The thumb position (left/right) is the non-color on/off cue; a contrast-safe
	   border keeps the track visible in high-contrast themes where the fill may vanish. */
	wa-switch::part(control) {
		background-color: color-mix(in srgb, var(--color-foreground) 25%, transparent);
		border: var(--gl-border-width) solid var(--vscode-contrastBorder, transparent);
	}

	/* wa-switch exposes checked as a CSS custom state (customStates.set('checked', …)),
	   not a reflected attribute — [checked] would never match */
	wa-switch:state(checked)::part(control) {
		background-color: var(--vscode-button-background);
		border-color: var(--vscode-contrastBorder, var(--vscode-button-background));
	}

	wa-switch::part(thumb) {
		background-color: var(--vscode-button-foreground, #fff);
		border: none;
		box-shadow: 0 1px 2px var(--vscode-widget-shadow);
	}

	wa-switch::part(label) {
		color: var(--color-foreground);
	}

	wa-switch:focus-within::part(control) {
		outline: var(--gl-border-width) solid var(--color-focus-border);
		outline-offset: 2px;
	}

	wa-switch[disabled] {
		cursor: not-allowed;
		opacity: 0.5;
	}

	@media (prefers-reduced-motion: reduce) {
		wa-switch::part(control),
		wa-switch::part(thumb) {
			transition: none;
		}
	}
`;
