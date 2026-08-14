import type { PropertyValues, TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { graphJumpToastStyles } from './gl-graph-jump-toast.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';

/** Which glyph the toast leads with — 'hidden' for a loaded-but-filtered row, 'terminal' for a jump
 *  that can never land, 'searching' for a still-in-flight host walk. */
export type GraphJumpToastKind = 'hidden' | 'terminal' | 'searching';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-jump-toast': GlGraphJumpToast;
	}

	interface GlobalEventHandlersEventMap {
		/** The toast's action link was clicked — the controller owns what it means for the current state. */
		'gl-jump-toast-action': CustomEvent<void>;
		/** The toast's ✕ was clicked. */
		'gl-jump-toast-dismiss': CustomEvent<void>;
	}
}

/**
 * A single floating status card reporting why a Commit Graph jump couldn't land (or that one is still
 * being looked for), overlaying the rows area. Deliberately dumb: the controller (`gl-graph-app`) owns
 * the state machine, message copy, remedies, and auto-dismiss timing — this component only renders
 * whatever it's handed and reports clicks back up.
 */
@customElement('gl-graph-jump-toast')
export class GlGraphJumpToast extends LitElement {
	static override styles = [graphJumpToastStyles];

	@property({ attribute: false })
	kind: GraphJumpToastKind = 'terminal';

	/** Pre-composed message (the target's ref name/sha is already styled by the caller). */
	@property({ attribute: false })
	message!: TemplateResult | string;

	@property({ attribute: 'action-label' })
	actionLabel?: string;

	override connectedCallback(): void {
		super.connectedCallback?.();

		// The host is the live region — the aria-live re-arm below must target the same element that
		// carries role="status" to have any effect.
		this.setAttribute('role', 'status');
		this.setAttribute('aria-live', 'polite');
	}

	protected override updated(changedProperties: PropertyValues): void {
		super.updated(changedProperties);

		// role="status" only announces content present when the live region is FIRST discovered — a
		// same-instance content swap (searching → failed, or one failure replacing another) needs a
		// fresh region to be re-announced. Cheapest re-arm: toggle it off the accessibility tree and
		// back on next frame.
		if (changedProperties.has('message') || changedProperties.has('kind')) {
			this.setAttribute('aria-live', 'off');
			requestAnimationFrame(() => this.setAttribute('aria-live', 'polite'));
		}
	}

	private onActionClick = (): void => {
		this.dispatchEvent(new CustomEvent('gl-jump-toast-action', { bubbles: true, composed: true }));
	};

	private onDismissClick = (): void => {
		this.dispatchEvent(new CustomEvent('gl-jump-toast-dismiss', { bubbles: true, composed: true }));
	};

	private renderIcon() {
		switch (this.kind) {
			case 'searching':
				return html`<code-icon icon="loading" modifier="spin"></code-icon>`;
			case 'hidden':
				return html`<code-icon icon="eye-closed"></code-icon>`;
			case 'terminal':
				return html`<code-icon icon="warning"></code-icon>`;
		}
	}

	override render(): unknown {
		return html`<div class="toast">
			<span class="toast__icon">${this.renderIcon()}</span>
			<span class="toast__message">${this.message}</span>
			${
				this.actionLabel != null
					? html`<button type="button" class="toast__action" @click=${this.onActionClick}>
							${this.actionLabel}
						</button>`
					: nothing
			}
			<gl-button
				class="toast__dismiss"
				appearance="toolbar"
				density="compact"
				aria-label="Dismiss"
				@click=${this.onDismissClick}
			>
				<code-icon icon="close"></code-icon>
			</gl-button>
		</div>`;
	}
}
