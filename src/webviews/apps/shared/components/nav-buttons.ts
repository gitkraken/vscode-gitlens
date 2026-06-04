import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { NavigationState } from '../controllers/navigationStack.js';
import './chips/action-chip.js';

/**
 * Shared back/forward buttons for commit history navigation, used by both the Inspect panel and the
 * Graph details panel. Driven by {@link NavigationState} (from the shared `NavigationStack`) and
 * emits `gl-nav-back` / `gl-nav-forward`.
 */
@customElement('gl-nav-buttons')
export class GlNavButtons extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: center;
			gap: 0.2rem;
		}
	`;

	@property({ attribute: false })
	navigation?: NavigationState;

	override render(): unknown {
		const nav = this.navigation;
		if (nav == null || nav.count <= 1) return nothing;

		return html`<gl-action-chip
				icon="arrow-left"
				label="Go Back"
				overlay="tooltip"
				?disabled=${!nav.canBack}
				@click=${this.onBack}
			></gl-action-chip>
			<gl-action-chip
				icon="arrow-right"
				label="Go Forward"
				overlay="tooltip"
				?disabled=${!nav.canForward}
				@click=${this.onForward}
			></gl-action-chip>`;
	}

	private onBack = (): void => {
		if (!this.navigation?.canBack) return;

		this.dispatchEvent(new CustomEvent('gl-nav-back', { bubbles: true, composed: true }));
	};

	private onForward = (): void => {
		if (!this.navigation?.canForward) return;

		this.dispatchEvent(new CustomEvent('gl-nav-forward', { bubbles: true, composed: true }));
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-nav-buttons': GlNavButtons;
	}
}
