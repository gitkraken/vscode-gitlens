import type WaSelect from '@awesome.me/webawesome/dist/components/select/select.js';
import { html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { selectStyles } from './select.css.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/popup/popup.js';
import '../code-icon.js';
import '../shoelace-stub.js';

export interface SelectOption {
	value: string;
	label: string;
	disabled?: boolean;
}

declare global {
	interface HTMLElementTagNameMap {
		['gl-select']: GlSelect;
	}
}

@customElement('gl-select')
export class GlSelect extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = selectStyles;

	@query('wa-select')
	private selectElement!: WaSelect;

	@property({ type: String })
	value: string = '';

	@property({ type: Boolean, reflect: true })
	disabled: boolean = false;

	/**
	 * Accessible name for the select. Forwarded to `wa-select`, whose internal
	 * combobox is `aria-labelledby` its label element; rendered visually hidden
	 * (compose any visible label outside the control).
	 */
	@property({ type: String })
	label?: string;

	@property({ type: String })
	placeholder?: string;

	@property({ type: Array })
	options: SelectOption[] = [];

	/**
	 * @deprecated No longer needed — `wa-popup` (used internally by `wa-select`) renders in the browser's
	 * top layer via the HTML Popover API, which escapes all clipping, stacking contexts, and transform
	 * containing blocks. Kept as a no-op for source compatibility; will be removed in a follow-up.
	 */
	@property({ type: Boolean })
	hoist: boolean = false;

	@property({ type: String })
	size: 'small' | 'medium' | 'large' = 'medium';

	private handleChange(e: Event) {
		const select = e.target as WaSelect;
		// Stop the inner change from bubbling out — we'll re-emit on this host below
		e.stopPropagation();
		this.value = select.value as string;

		// Emit custom event for consistency with other gl-* components
		const changeEvent = new CustomEvent('gl-change-value', {
			detail: { value: this.value },
			bubbles: true,
			composed: true,
		});
		this.dispatchEvent(changeEvent);

		// Also emit native change event for compatibility
		const nativeChangeEvent = new Event('change', {
			bubbles: true,
			composed: true,
		});
		this.dispatchEvent(nativeChangeEvent);
	}

	override render() {
		return html`
			<wa-select
				exportparts="combobox, display-input, expand-icon, listbox"
				value=${this.value}
				?disabled=${this.disabled}
				label=${ifDefined(this.label)}
				placeholder=${ifDefined(this.placeholder)}
				size=${this.size}
				@change=${this.handleChange}
			>
				<code-icon icon="chevron-down" slot="expand-icon"></code-icon>
				${this.options.map(
					option => html`
						<wa-option value=${option.value} ?disabled=${option.disabled ?? false}>
							${option.label}
						</wa-option>
					`,
				)}
				<slot></slot>
			</wa-select>
		`;
	}

	override focus(options?: FocusOptions) {
		this.selectElement?.focus(options);
	}

	override blur() {
		this.selectElement?.blur();
	}

	/** Opens the listbox. */
	async show(): Promise<void> {
		await this.selectElement?.show();
	}

	/** Closes the listbox. */
	async hide(): Promise<void> {
		await this.selectElement?.hide();
	}
}
