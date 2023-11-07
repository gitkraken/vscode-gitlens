import { css, html, LitElement } from 'lit';
import { customElement, queryAssignedElements } from 'lit/decorators.js';

@customElement('action-nav')
export class ActionNav extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			align-items: center;
			user-select: none;
		}
	`;

	private _slotSubscriptionsDisposer?: () => void;

	@queryAssignedElements({ flatten: true })
	private actionNodes!: HTMLElement[];

	override firstUpdated() {
		this.role = 'navigation';
	}

	override disconnectedCallback() {
		this._slotSubscriptionsDisposer?.();
	}

	override render() {
		return html`<slot @slotchange=${this.handleSlotChange}></slot>`;
	}

	private handleSlotChange(_e: Event) {
		this._slotSubscriptionsDisposer?.();

		if (this.actionNodes.length < 2) return;

		const handleKeydown = this.handleKeydown.bind(this);
		const size = `${this.actionNodes.length}`;
		const subs = this.actionNodes.map((element, i) => {
			element.setAttribute('aria-posinset', `${i + 1}`);
			element.setAttribute('aria-setsize', size);
			element.setAttribute('tabindex', i === 0 ? '0' : '-1');
			element.addEventListener('keydown', handleKeydown, false);
			return {
				dispose: () => {
					element?.removeEventListener('keydown', handleKeydown, false);
				},
			};
		});

		this._slotSubscriptionsDisposer = () => {
			subs?.forEach(({ dispose }) => dispose());
		};
	}

	private handleKeydown(e: KeyboardEvent) {
		if (!e.target || this.actionNodes == null || this.actionNodes.length < 2) return;
		const target = e.target as HTMLElement;
		const posinset = parseInt(target.getAttribute('aria-posinset') ?? '0', 10);

		let $next: HTMLElement | null = null;
		if (e.key === 'ArrowLeft') {
			const next = posinset === 1 ? this.actionNodes.length - 1 : posinset - 2;
			$next = this.actionNodes[next];
		} else if (e.key === 'ArrowRight') {
			const next = posinset === this.actionNodes.length ? 0 : posinset;
			$next = this.actionNodes[next];
		}
		if ($next == null || $next === target) {
			return;
		}
		target.setAttribute('tabindex', '-1');
		$next.setAttribute('tabindex', '0');
		$next.focus();
	}
}
