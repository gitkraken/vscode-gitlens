import { css, html, LitElement, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AnnotationsSvg } from './svg-annotations';
import type { RevisionNavigationSvg } from './svg-revision-navigation';

@customElement('gk-editor-toolbar-svg')
export class EditorToolbarSvg extends LitElement {
	static override styles = css`
		:host > svg {
			display: block;
			max-width: 69.2rem;
			width: calc(100% - 2rem);
			height: auto;
			margin: 0 1rem;

			fill: var(--vscode-menu-background);
		}

		* {
			user-select: none;
		}

		.codicon {
			font-family: codicon;
			cursor: default;
			user-select: none;
		}

		.glicon {
			font-family: glicons;
			cursor: default;
			user-select: none;
		}

		.interactive {
			cursor: pointer;
		}

		.icon {
			fill: var(--vscode-icon-foreground);
			font-size: 16px;
		}

		.icon.active {
			fill: var(--color-foreground);
		}

		.icon.inactive {
			opacity: 0.6;
		}

		.icon__annotations circle {
			fill: #f05133;
			stroke: none;
		}

		.icon__annotations path {
			fill: var(--vscode-menu-background);
		}

		@keyframes wiggle {
			0%,
			8%,
			100% {
				transform: rotate(0) scale(1);
			}

			1%,
			4% {
				transform: rotate(0.02turn) scale(var(--wiggle-scale-1));
			}

			2%,
			6% {
				transform: rotate(-0.02turn) scale(var(--wiggle-scale-2));
			}
		}

		.icon__annotations {
			--wiggle-scale-1: 1.14;
			--wiggle-scale-2: 1.28;

			transform-origin: 60%;
			animation: wiggle 5s ease-in-out 2s infinite;
			animation-timing-function: steps(8);
		}

		.icon__revision {
			--wiggle-scale-1: 1.14;
			--wiggle-scale-2: 1.28;

			transform-origin: 5%;
			animation: wiggle 5s ease-in-out 4s infinite;
			animation-timing-function: steps(8);
		}

		:host([revision-toggled]) .icon__revision-bg {
			fill: var(--color-foreground);
			opacity: 0.2;
		}
		:host(:not([revision-toggled])) .icon__revision-bg {
			fill: none;
		}
	`;

	@property({ type: Boolean, reflect: true })
	annotations?: boolean;

	@property({ type: Boolean, reflect: true })
	revision?: boolean;

	@property({ type: Boolean, reflect: true, attribute: 'annotations-toggled' })
	annotationsToggled?: boolean;

	@property({ type: Boolean, reflect: true, attribute: 'revision-toggled' })
	revisionToggled?: boolean;

	protected onClick(e: Event) {
		const feature = (e.target as HTMLElement).dataset.feature;
		switch (feature) {
			case 'annotations': {
				this.annotationsToggled = !this.annotationsToggled;
				const $el = document.getElementById('annotations') as AnnotationsSvg;
				$el.toggled = !$el.toggled;

				break;
			}
			case 'revision': {
				this.revisionToggled = !this.revisionToggled;
				const $el = document.getElementById('revision') as RevisionNavigationSvg;
				$el.toggled = !$el.toggled;

				break;
			}
		}

		this.dispatchEvent(new CustomEvent('click'));
	}

	override render() {
		return html`
			<!-- Don't reformat or let prettier reformat the SVG otherwise whitespace will get added incorrect and screw up the positioning -->
			<!-- prettier-ignore -->
			<svg width="148" height="22" viewBox="-4 -3 147 20" fill="none" xmlns="http://www.w3.org/2000/svg">
				${this.revision ? svg`<rect class="icon__revision-bg" x="-4" y="-2.5" width="24" height="20.5" rx="4"/>` : ''}
				<text y="16" class="icon ${this.revision ? 'icon__revision active' : 'inactive'}">
					<tspan class="glicon">&#xf105;</tspan>
				</text>
				<text y="16" class="icon inactive">
					<tspan dx="25" class="glicon">&#xf101;</tspan><tspan dx="9" class="glicon">&#xf103;</tspan><tspan dx="32" class="codicon">&#xeb56;</tspan><tspan dx="9" class="codicon">&#xea7c;</tspan>
				</text>

				${this.annotationsToggled
				? svg`<g class="icon icon__annotations">
						<circle cx="83" cy="8" r="7.5" />
						<path
							d="M84.2583 4.71315C84.4119 4.44544 84.4999 4.13329 84.4999 3.79998C84.4999 2.80588 83.7165 2 82.75 2C81.7835 2 81 2.80588 81 3.79998C81 4.62503 81.5397 5.32043 82.2757 5.53309V10.4669C81.5397 10.6796 81 11.375 81 12.2C81 13.1941 81.7835 14 82.75 14C83.7165 14 84.4999 13.1941 84.4999 12.2C84.4999 11.3747 83.96 10.6792 83.2236 10.4667V5.53326C83.3465 5.49782 83.4638 5.44893 83.5741 5.38824L85.2151 7.07621C85.1305 7.26617 85.0834 7.47746 85.0834 7.70007C85.0834 8.52849 85.7363 9.20005 86.5417 9.20005C87.3471 9.20005 88 8.52849 88 7.70007C88 6.87165 87.3471 6.20008 86.5417 6.20008C86.2988 6.20008 86.0697 6.26117 85.8683 6.36922L84.2583 4.71315Z"
						/>
				  </g>`
				: svg`<text y="16" class="icon ${
						this.annotations ? 'icon__annotations' : 'inactive'
				  }"><tspan dx="75" class="glicon">&#xf113;</tspan></text>`}

				${this.revision
				? svg`<rect
						class="interactive"
						data-feature="revision"
						x="0"
						y="0"
						width="16"
						height="16"
						fill="transparent"
						stroke="none"
						@click=${this.onClick}
				  ></rect>`
				: ''}
				${this.annotations
				? svg`<rect
						class="interactive"
						data-feature="annotations"
						x="80"
						y="0"
						width="16"
						height="16"
						fill="transparent"
						stroke="none"
						@click=${this.onClick}
				  ></rect>`
				: ''}
			</svg>
		`;
	}
}
