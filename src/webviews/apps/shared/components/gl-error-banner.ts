import type { Signal } from '@lit-labs/signals';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './banner/banner.js';

@customElement('gl-error-banner')
export class GlErrorBanner extends SignalWatcher(LitElement) {
	@property({ attribute: false })
	error!: Signal.State<string | undefined>;

	override render(): unknown {
		const msg = this.error.get();
		if (!msg) return nothing;

		return html`<gl-banner
			display="solid"
			banner-title="Something went wrong"
			.body=${msg}
			dismissible
			@gl-banner-dismiss=${() => this.error.set(undefined)}
		></gl-banner>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-error-banner': GlErrorBanner;
	}
}
