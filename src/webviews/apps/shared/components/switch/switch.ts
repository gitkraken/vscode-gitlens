import type WaSwitch from '@awesome.me/webawesome/dist/components/switch/switch.js';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { switchStyles } from './switch.css.js';
import '@awesome.me/webawesome/dist/components/switch/switch.js';
import '../shoelace-stub.js';

export const tagName = 'gl-switch';

/**
 * An on/off toggle switch wrapping `wa-switch`, themed for VS Code.
 *
 * Unlike a checkbox, a switch applies its change immediately — use it for
 * enabling/disabling a feature, not for selecting items.
 *
 * The default slot is the visible label; when no label is slotted, provide
 * `label` so the control still has an accessible name.
 */
@customElement(tagName)
export class GlSwitch extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = switchStyles;

	@query('wa-switch')
	private switchElement!: WaSwitch;

	@property({ type: Boolean, reflect: true })
	checked: boolean = false;

	@property({ type: Boolean, reflect: true })
	disabled: boolean = false;

	/** Accessible name when no visible label is slotted (rendered as visually-hidden slot fallback). */
	@property({ type: String })
	label?: string;

	@property({ type: String, reflect: true })
	size: 'medium' | 'large' = 'medium';

	private handleChange(e: Event) {
		// Stop the inner change from bubbling out — we'll re-emit on this host below
		e.stopPropagation();
		this.checked = (e.target as WaSwitch).checked;

		this.dispatchEvent(new CustomEvent('gl-change-value', { bubbles: true, composed: true }));
		this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
	}

	override render(): unknown {
		// The switch's accessible name comes from the <label> wrapping the input
		// in wa-switch's shadow DOM, which contains only the slot chain — host
		// ARIA attributes never reach the focused input. So `label` renders as
		// visually-hidden fallback slot content rather than an aria-label.
		return html`<wa-switch
			exportparts="base, control, thumb, label"
			.checked=${this.checked}
			?disabled=${this.disabled}
			@change=${this.handleChange}
			><slot>${this.label ? html`<span class="sr-only">${this.label}</span>` : nothing}</slot></wa-switch
		>`;
	}

	override focus(options?: FocusOptions): void {
		this.switchElement?.focus(options);
	}

	override blur(): void {
		this.switchElement?.blur();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: GlSwitch;
	}
}
