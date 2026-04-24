import type SlSelect from '@shoelace-style/shoelace/dist/components/select/select.js';
import { html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { selectStyles } from './select.css.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/popup/popup.js';
import '../code-icon.js';
import '../shoelace-stub.js';

export const tagName = 'gl-select';

export interface SelectOption {
	value: string;
	label: string;
	disabled?: boolean;
}

@customElement(tagName)
export class GlSelect extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = selectStyles;

	@query('sl-select')
	private selectElement!: SlSelect;

	@property({ type: String })
	value: string = '';

	@property({ type: Boolean, reflect: true })
	disabled: boolean = false;

	@property({ type: String })
	placeholder?: string;

	@property({ type: Array })
	options: SelectOption[] = [];

	@property({ type: Boolean })
	hoist: boolean = false;

	@property({ type: String })
	size: 'small' | 'medium' | 'large' = 'medium';

	private handleChange(e: Event) {
		const select = e.target as SlSelect;
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
			<sl-select
				value=${this.value}
				?disabled=${this.disabled}
				placeholder=${ifDefined(this.placeholder)}
				?hoist=${this.hoist}
				size=${this.size}
				@sl-change=${this.handleChange}
			>
				<code-icon icon="chevron-down" slot="expand-icon"></code-icon>
				${this.options.map(
					option => html`
						<sl-option value=${option.value} ?disabled=${option.disabled ?? false}>
							${option.label}
						</sl-option>
					`,
				)}
				<slot></slot>
			</sl-select>
		`;
	}

	override focus(options?: FocusOptions) {
		this.selectElement?.focus(options);
	}

	override blur() {
		this.selectElement?.blur();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: GlSelect;
	}
}
