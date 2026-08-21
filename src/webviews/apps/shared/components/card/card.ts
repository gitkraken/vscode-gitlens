import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { cardStyles } from './card.css.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-card']: GlCard;
	}
}

@customElement('gl-card')
export class GlCard extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [cardStyles];

	@property({ reflect: true })
	indicator?:
		| 'base'
		| 'active'
		| 'info'
		| 'cherry-picking'
		| 'merging'
		| 'rebasing'
		| 'reverting'
		| 'conflict'
		| 'issue-open'
		| 'issue-closed'
		| 'pr-open'
		| 'pr-closed'
		| 'pr-merged'
		| 'mergeable'
		| 'blocked'
		| 'attention'
		| 'branch-merged'
		| 'branch-synced'
		| 'branch-diverged'
		| 'branch-behind'
		| 'branch-ahead'
		| 'branch-changes'
		| 'branch-missingUpstream';

	@property({ reflect: true })
	grouping?: 'unit' | 'item' | 'item-primary';

	@property({ reflect: true })
	density?: 'tight';

	@property()
	href?: string;

	/** Opt-in toggle state. Undefined (the default) keeps the card a plain focusable/link element —
	 *  no `role` or `aria-pressed` are emitted. Set it (even to `false`) to expose the card as a
	 *  toggle button to assistive tech, e.g. a scope/filter card that can be pressed and unpressed. */
	@property({ type: Boolean })
	pressed?: boolean;

	private _focusable = false;
	@property({ type: Boolean, reflect: true })
	get focusable(): boolean {
		if (this.href != null) return true;
		return this._focusable;
	}
	set focusable(value: boolean) {
		const oldValue = this._focusable;
		this._focusable = value;
		this.requestUpdate('focusable', oldValue);
	}

	get classNames(): Record<string, boolean> {
		return {
			card: true,
			'card--focusable': this.focusable,
			[`card--grouping-${this.grouping}`]: this.grouping != null,
			[`card--density-${this.density}`]: this.density != null,
			[`is-${this.indicator}`]: this.indicator != null,
		};
	}

	override render(): unknown {
		// `aria-pressed` is only meaningful on a `button`-rolelike element, and the base `<a>`/`<div>`
		// otherwise carry no explicit role — so pair the state with `role="button"` and gate both the
		// same way. Left undefined (the default), the focusable element is untouched.
		const role = this.pressed === undefined ? nothing : 'button';
		const ariaPressed = this.pressed === undefined ? nothing : this.pressed ? 'true' : 'false';

		if (this.href != null) {
			return html`<a
				part="base"
				class=${classMap(this.classNames)}
				href=${this.href}
				role=${role}
				aria-pressed=${ariaPressed}
				>${this.renderContent()}</a
			>`;
		}

		return html`<div
			part="base"
			tabindex=${this.focusable ? 0 : -1}
			class=${classMap(this.classNames)}
			role=${role}
			aria-pressed=${ariaPressed}
		>
			${this.renderContent()}
		</div>`;
	}

	private renderContent() {
		return html`
			<slot class="card__content"></slot>
			<slot name="actions" class="card__actions"></slot>
		`;
	}

	override focus(options?: FocusOptions): void {
		if (this.href != null) {
			this.shadowRoot?.querySelector('a')?.focus(options);
		} else {
			super.focus(options);
		}
	}
}
