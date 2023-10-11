import { css, html, LitElement } from 'lit';
import { customElement, queryAssignedElements } from 'lit/decorators.js';
import type { FileChangeListItem } from './file-change-list-item';
import type { ListItem, ListItemSelectedEvent } from './list-item';

@customElement('list-container')
export class ListContainer extends LitElement {
	static override styles = css`
		::slotted(*) {
			box-sizing: inherit;
		}
	`;

	private _lastSelected!: ListItem | undefined;
	private _slotSubscriptionsDisposer?: () => void;

	@queryAssignedElements()
	private _listItems!: (ListItem | FileChangeListItem)[];

	handleSlotChange(_e: Event) {
		this._slotSubscriptionsDisposer?.();

		if (!this._listItems?.length) return;
		const subscriptions = this._listItems.map(node => {
			const keyHandler = this.handleKeydown.bind(this);
			const beforeSelectHandler = this.handleBeforeSelected.bind(this);
			const selectHandler = this.handleSelected.bind(this);
			node.addEventListener('keydown', keyHandler, false);
			node.addEventListener('select', beforeSelectHandler, false);
			node.addEventListener('selected', selectHandler, false);

			return {
				dispose: function () {
					node?.removeEventListener('keydown', keyHandler, false);
					node?.removeEventListener('select', beforeSelectHandler, false);
					node?.removeEventListener('selected', selectHandler, false);
				},
			};
		});

		this._slotSubscriptionsDisposer = () => {
			subscriptions?.forEach(({ dispose }) => dispose());
		};
	}

	override disconnectedCallback() {
		super.disconnectedCallback();

		this._slotSubscriptionsDisposer?.();
	}

	handleBeforeSelected(e: Event) {
		if (!e.target) return;

		const target = e.target as ListItem;
		if (this._lastSelected != null && this._lastSelected !== target) {
			this._lastSelected.deselect();
		}
		this._lastSelected = target;
	}

	handleSelected(e: ListItemSelectedEvent) {
		if (!e.target || !e.detail.branch) return;

		function getLevel(el: ListItem) {
			return parseInt(el.getAttribute('level') ?? '0', 10);
		}

		function getParent(el: ListItem) {
			const level = getLevel(el);
			let prev = el.previousElementSibling as ListItem | null;
			while (prev) {
				const prevLevel = getLevel(prev);
				if (prevLevel < level) return prev;

				prev = prev.previousElementSibling as ListItem | null;
			}

			return undefined;
		}

		const target = e.target as ListItem;
		const level = getLevel(target);

		let nextElement = target.nextElementSibling as ListItem | null;
		while (nextElement) {
			if (level == getLevel(nextElement)) break;

			const parentElement = getParent(nextElement);
			nextElement.parentexpanded = parentElement?.expanded !== false;
			nextElement.expanded = e.detail.expanded;

			nextElement = nextElement.nextElementSibling as ListItem;
		}
	}

	handleKeydown(e: KeyboardEvent) {
		if (!e.target) return;
		const target = e.target as ListItem;

		if (e.key === 'ArrowUp') {
			const $previous: HTMLElement | null = target.previousElementSibling as HTMLElement;
			$previous?.focus();
		} else if (e.key === 'ArrowDown') {
			const $next: HTMLElement | null = target.nextElementSibling as HTMLElement;
			$next?.focus();
		}
	}

	override firstUpdated() {
		this.setAttribute('role', 'tree');
	}

	override render() {
		return html`<slot @slotchange=${this.handleSlotChange}></slot>`;
	}
}
