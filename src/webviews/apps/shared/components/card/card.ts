import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { cardStyles } from './card.css';

export const cardTagName = 'gl-card';

@customElement(cardTagName)
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
		if (this.href != null) {
			return html`<a part="base" class=${classMap(this.classNames)} href=${this.href}
				>${this.renderContent()}</a
			>`;
		}

		return html`<div part="base" tabindex=${this.focusable ? 0 : -1} class=${classMap(this.classNames)}>
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

declare global {
	interface HTMLElementTagNameMap {
		[cardTagName]: GlCard;
	}
}
