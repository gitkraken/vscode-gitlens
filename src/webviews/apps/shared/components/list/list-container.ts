import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { FileChangeListItem } from './file-change-list-item';
import type { ListItem, ListItemSelectedEvent } from './list-item';

const BesideViewColumn = -2; /*ViewColumn.Beside*/

@customElement('list-container')
export class ListContainer extends LitElement {
	static override styles = css`
		::slotted(*) {
			box-sizing: inherit;
		}
	`;

	private _lastSelected!: ListItem | undefined;
	private _slotSubscriptionsDisposer?: () => void;

	handleSlotChange(e: Event) {
		this._slotSubscriptionsDisposer?.();

		const nodes = (e.target as HTMLSlotElement).assignedNodes();
		if (!nodes?.length) return;

		const subscriptions = (nodes?.filter(node => node.nodeType === 1) as (ListItem | FileChangeListItem)[]).map(
			node => {
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
			},
		);

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

			if (parentElement?.expanded === false) {
				nextElement.removeAttribute('parentexpanded');
			} else {
				nextElement.setAttribute('parentexpanded', '');
			}

			if (e.detail.expanded) {
				nextElement.setAttribute('expanded', '');
			} else {
				nextElement.removeAttribute('expanded');
			}

			nextElement = nextElement.nextElementSibling as ListItem;
		}
	}

	handleKeydown(e: KeyboardEvent) {
		if (!e.target) return;
		const target = e.target as ListItem;

		if (e.key === 'Enter' || e.key === ' ') {
			target.select({
				preserveFocus: e.key !== 'Enter',
				viewColumn: e.altKey ? BesideViewColumn : undefined,
			});
		} else if (e.key === 'ArrowUp') {
			const $previous: HTMLElement | null = target.previousElementSibling as HTMLElement;
			$previous?.focus();
		} else if (e.key === 'ArrowDown') {
			const $next: HTMLElement | null = target.nextElementSibling as HTMLElement;
			$next?.focus();
		}
	}

	override firstUpdated() {
		this.setAttribute('role', 'tree');

		this.shadowRoot?.querySelector('slot')?.addEventListener('slotchange', this.handleSlotChange.bind(this));
	}

	override render() {
		return html`<slot></slot>`;
	}
}
