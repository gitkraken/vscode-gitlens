import type { PropertyValues } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('progress-indicator')
export class ProgressIndicator extends LitElement {
	static override styles = css`
		* {
			box-sizing: border-box;
		}

		:host {
			position: absolute;
			left: 0;
			bottom: 0;
			z-index: 5;
			height: 2px;
			width: 100%;
			overflow: hidden;
		}

		:host([position='top']) {
			top: 0;
			bottom: auto;
		}

		.progress-bar {
			background-color: var(--vscode-progressBar-background);
			display: none;
			position: absolute;
			left: 0;
			width: 2%;
			height: 2px;
		}

		:host([visible]) .progress-bar {
			display: inherit;
		}

		:host([mode='discrete']) .progress-bar {
			left: 0;
			transition: width 0.1s linear;
		}

		:host([mode='discrete done']) .progress-bar {
			width: 100%;
		}

		:host([mode='infinite']) .progress-bar {
			animation-name: progress;
			animation-duration: 4s;
			animation-iteration-count: infinite;
			animation-timing-function: steps(100);
			transform: translateZ(0);
		}

		@keyframes progress {
			0% {
				transform: translateX(0) scaleX(1);
			}

			50% {
				transform: translateX(2500%) scaleX(3);
			}

			to {
				transform: translateX(4900%) scaleX(1);
			}
		}
	`;

	@property({ reflect: true })
	mode = 'infinite';

	@property({ type: Boolean })
	active = false;

	/** Minimum time (ms) the bar stays visible once shown, so very brief operations don't flash
	 *  imperceptibly. 0 (default) preserves the original show/hide-immediately behavior. */
	@property({ type: Number, attribute: 'min-visible' })
	minVisible = 0;

	@property()
	position: 'top' | 'bottom' = 'bottom';

	private _shownAt = 0;
	private _hideTimer?: ReturnType<typeof setTimeout>;

	override willUpdate(changedProperties: PropertyValues): void {
		if (!changedProperties.has('active')) return;

		if (this.active) {
			if (this._hideTimer != null) {
				clearTimeout(this._hideTimer);
				this._hideTimer = undefined;
			}
			// Anchor the min-visible floor to THIS activation (even if `visible` is still set from a
			// deferred hide) so back-to-back shows each get the full hold, not the first show's leftover.
			this._shownAt = performance.now();
			this.toggleAttribute('visible', true);
		} else if (this.hasAttribute('visible')) {
			const remaining = this.minVisible - (performance.now() - this._shownAt);
			if (remaining > 0) {
				this._hideTimer = setTimeout(() => {
					this._hideTimer = undefined;
					this.toggleAttribute('visible', false);
				}, remaining);
			} else {
				this.toggleAttribute('visible', false);
			}
		}
	}

	override firstUpdated(): void {
		this.setAttribute('role', 'progressbar');
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		if (this._hideTimer != null) {
			clearTimeout(this._hideTimer);
			this._hideTimer = undefined;
			// A pending hide means `active` is already false but `visible` is held — complete it on
			// teardown so a reconnected instance doesn't paint the bar while inactive.
			this.toggleAttribute('visible', false);
		}
	}

	override render(): unknown {
		return html`<div class="progress-bar"></div>`;
	}
}
