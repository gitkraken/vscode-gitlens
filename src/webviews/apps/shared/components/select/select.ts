import type SlSelect from '@shoelace-style/shoelace/dist/components/select/select.js';
import { html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { selectStyles } from './select.css';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/popup/popup.js';
import '../code-icon';

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
		console.log('[REBASE] select handleChange', { value: this.value });

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
		console.log('[REBASE] select events dispatched');
	}

	private handleShow() {
		console.log('[REBASE] select sl-show fired');
		// Log popup state
		requestAnimationFrame(() => {
			const popup = this.selectElement?.shadowRoot?.querySelector('sl-popup');
			console.log('[REBASE] select popup element:', popup);
			if (popup) {
				const style = getComputedStyle(popup);
				console.log('[REBASE] select popup style:', {
					display: style.display,
					visibility: style.visibility,
					opacity: style.opacity,
					zIndex: style.zIndex,
					position: style.position,
				});
			}
			// Check for hoisted popup in document
			const hoistedPopups = document.querySelectorAll('sl-popup');
			console.log('[REBASE] hoisted popups in document:', hoistedPopups.length);
		});
	}

	private handleHide() {
		console.log('[REBASE] select sl-hide fired');
	}

	private handleClick(e: MouseEvent) {
		console.log('[REBASE] select clicked', { target: e.target, currentTarget: e.currentTarget });
	}

	override render() {
		console.log('[REBASE] select render', {
			value: this.value,
			optionCount: this.options.length,
			hoist: this.hoist,
			size: this.size,
		});
		return html`
			<sl-select
				value=${this.value}
				?disabled=${this.disabled}
				placeholder=${ifDefined(this.placeholder)}
				?hoist=${this.hoist}
				size=${this.size}
				@sl-change=${this.handleChange}
				@sl-show=${this.handleShow}
				@sl-hide=${this.handleHide}
				@click=${this.handleClick}
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
