import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { OnboardingKeys } from '../../../../../constants.onboarding.js';
import type { OnboardingDismissals } from '../../contexts/onboardingDismissals.js';
import { onboardingDismissalsContext } from '../../contexts/onboardingDismissals.js';
import { pulseStyles } from './indicator.css.js';
import { newIndicatorStyles } from './new-indicator.css.js';

@customElement('gl-new-indicator')
export class GlNewIndicator extends SignalWatcher(LitElement) {
	static override styles = [newIndicatorStyles, pulseStyles];

	@property() key?: OnboardingKeys;
	@property({ type: Boolean }) pulse = false;

	@consume({ context: onboardingDismissalsContext, subscribe: true })
	private readonly _dismissals?: OnboardingDismissals;

	constructor() {
		super();
		// Any interaction with the adorned control dismisses the "new" dot for good. Unknown state
		// (initial fetch still in flight) counts as dismissible so an early click isn't lost —
		// dismissal is idempotent host-side; only a known-dismissed key skips the call.
		this.addEventListener('click', () => {
			const key = this.key;
			if (key != null && this._dismissals != null && this._dismissals.get(key) !== true) {
				this._dismissals.dismiss(key);
			}
		});
	}

	override render(): unknown {
		const show = this.key != null && this._dismissals?.get(this.key) === false;
		return html`<slot></slot>${show
				? html`<span class="dot${this.pulse ? ' indicator--pulse' : ''}" aria-hidden="true"></span>`
				: nothing}`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		['gl-new-indicator']: GlNewIndicator;
	}
}
