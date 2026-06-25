import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GlElement } from '../element.js';
import { segmentedStyles } from './segmented.css.js';

export interface SegmentedOption {
	value: string;
	label: string;
}

declare global {
	interface HTMLElementTagNameMap {
		['gl-segmented-control']: GlSegmentedControl;
	}
}

/**
 * A segmented control — a compact, always-visible alternative to a radio group
 * for 2–4 mutually exclusive choices.
 *
 * Follows the WAI-ARIA radio-group pattern: one tab stop, arrow keys move
 * between segments and select as they go (selection follows focus).
 */
@customElement('gl-segmented-control')
export class GlSegmentedControl extends GlElement {
	static override readonly styles = [segmentedStyles];

	@property({ type: Array })
	options: SegmentedOption[] = [];

	@property({ type: String })
	value?: string;

	@property({ type: Boolean, reflect: true })
	disabled: boolean = false;

	/** Accessible name for the group. */
	@property({ type: String })
	label?: string;

	private select(value: string) {
		if (this.disabled || value === this.value) return;

		this.value = value;
		this.dispatchEvent(new CustomEvent('gl-change-value', { bubbles: true, composed: true }));
	}

	private handleKeyDown(e: KeyboardEvent) {
		if (this.disabled || !this.options.length) return;

		let next: number;
		const current = this.options.findIndex(o => o.value === this.value);
		switch (e.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				next = current < 0 ? 0 : (current + 1) % this.options.length;
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				next =
					current < 0 ? this.options.length - 1 : (current - 1 + this.options.length) % this.options.length;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = this.options.length - 1;
				break;
			default:
				return;
		}

		e.preventDefault();
		const option = this.options[next];
		this.select(option.value);
		void this.updateComplete.then(() => {
			this.renderRoot
				.querySelector<HTMLButtonElement>(`button[data-value="${CSS.escape(option.value)}"]`)
				?.focus();
		});
	}

	override render(): unknown {
		const selected = this.options.find(o => o.value === this.value) ?? this.options[0];
		return html`<div
			class="group"
			role="radiogroup"
			aria-label=${this.label ?? 'Options'}
			@keydown=${this.handleKeyDown}
		>
			${this.options.map(
				o =>
					html`<button
						type="button"
						class="segment"
						role="radio"
						data-value=${o.value}
						aria-checked=${o.value === this.value}
						tabindex=${o === selected ? 0 : -1}
						?disabled=${this.disabled}
						@click=${() => this.select(o.value)}
					>
						${o.label}
					</button>`,
			)}
		</div>`;
	}
}
