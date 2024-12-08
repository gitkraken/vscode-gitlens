import { css, LitElement, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { iconMap as codiconsMap } from './icons/codicons-map';
import { iconMap as gliconsMap } from './icons/glicons-map';

function iconToSelector(name: string, char: string, prefix = '') {
	return /*css*/ `:host([icon='${prefix}${name}'])::before { content: '${char}'; }`;
}

function generateIconStyles(iconMap: Record<string, string>, prefix = '') {
	return unsafeCSS(
		Object.entries(iconMap)
			.map(([key, value]) => iconToSelector(key, value, prefix))
			.join(''),
	);
}

@customElement('code-icon')
export class CodeIcon extends LitElement {
	static override styles = css`
		:host {
			--code-icon-size: 16px;
			--code-icon-v-align: text-bottom;

			font: normal normal normal var(--code-icon-size, 16px) / 1 codicon;
			display: inline-block;
			text-decoration: none;
			text-rendering: auto;
			text-align: center;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
			user-select: none;
			-webkit-user-select: none;
			-ms-user-select: none;
			color: inherit;
			vertical-align: var(--code-icon-v-align);
			letter-spacing: normal;
		}

		:host([icon^='gl-']) {
			font-family: 'glicons';
		}

		${generateIconStyles(codiconsMap)}
		${generateIconStyles(gliconsMap, 'gl-')}

		:host([icon='custom-start-work']) {
			position: relative;
		}
		:host([icon='custom-start-work'])::before {
			content: '\\ea68';
		}
		:host([icon='custom-start-work'])::after {
			content: '\\ea60';
			position: absolute;
			right: -0.2em;
			bottom: -0.2em;
			font-size: 0.6em;
			line-height: normal;
		}

		:host([icon='gl-pinned-filled']):before {
			/* TODO: see relative positioning needed in every use-case */
			position: relative;
			left: 1px;
		}

		@keyframes codicon-spin {
			100% {
				transform: rotate(360deg);
			}
		}

		:host([modifier='spin']) {
			/* Use steps to throttle FPS to reduce CPU usage */
			animation: codicon-spin 1.5s steps(30) infinite;
		}
		:host([icon='loading'][modifier='spin']) {
			/* Use steps to throttle FPS to reduce CPU usage */
			animation: codicon-spin 1.5s steps(30) infinite;

			/* custom speed & easing for loading icon */
			animation-duration: 1s !important;
			animation-timing-function: cubic-bezier(0.53, 0.21, 0.29, 0.67) !important;
		}

		:host([flip='inline']) {
			transform: rotateY(180deg);
		}

		:host([flip='block']) {
			transform: rotateX(180deg);
		}

		:host([rotate='45']) {
			transform: rotateZ(45deg);
		}
	`;
	@property({ reflect: true })
	icon = '';

	@property({ reflect: true })
	modifier = '';

	@property({ type: Number })
	size: number | undefined = undefined;

	@property({ reflect: true })
	flip?: 'inline' | 'block';

	@property({ reflect: true })
	rotate?: '45';

	override updated(changedProperties: Map<string, unknown>) {
		if (changedProperties.has('size')) {
			this.style.setProperty('--code-icon-size', `${this.size}px`);
		}
		super.update(changedProperties);
	}
}
