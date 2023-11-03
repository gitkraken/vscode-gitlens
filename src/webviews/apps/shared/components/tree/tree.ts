import { html, LitElement } from 'lit';
import { customElement, property, queryAssignedElements } from 'lit/decorators.js';
import type { TreeItemSelectionDetail } from './base';
import type { GlTreeItem } from './tree-item';
import { treeStyles } from './tree.css';

@customElement('gl-tree')
export class GlTree extends LitElement {
	static override styles = treeStyles;

	@property({ reflect: true })
	guides?: 'none' | 'onHover' | 'always';

	private _slotSubscriptionsDisposer?: () => void;

	private _lastSelected?: GlTreeItem;

	@queryAssignedElements({ flatten: true })
	private treeItems!: GlTreeItem[];

	override disconnectedCallback() {
		super.disconnectedCallback();

		this._slotSubscriptionsDisposer?.();
	}

	override firstUpdated() {
		this.setAttribute('role', 'tree');
	}

	override render() {
		return html`<slot @slotchange=${this.handleSlotChange}></slot>`;
	}

	private handleSlotChange() {
		console.log('handleSlotChange');

		if (!this.treeItems?.length) return;

		const keyHandler = this.handleKeydown.bind(this);
		const beforeSelectHandler = this.handleBeforeSelected.bind(this) as EventListenerOrEventListenerObject;
		const selectHandler = this.handleSelected.bind(this) as EventListenerOrEventListenerObject;
		const subscriptions = this.treeItems.map(node => {
			node.addEventListener('keydown', keyHandler, false);
			node.addEventListener('gl-tree-item-select', beforeSelectHandler, false);
			node.addEventListener('gl-tree-item-selected', selectHandler, false);

			return {
				dispose: function () {
					node?.removeEventListener('keydown', keyHandler, false);
					node?.removeEventListener('gl-tree-item-select', beforeSelectHandler, false);
					node?.removeEventListener('gl-tree-item-selected', selectHandler, false);
				},
			};
		});

		this._slotSubscriptionsDisposer = () => {
			subscriptions?.forEach(({ dispose }) => dispose());
		};
	}

	private handleKeydown(e: KeyboardEvent) {
		if (!e.target) return;
		const target = e.target as HTMLElement;

		if (e.key === 'ArrowUp') {
			const $previous = target.previousElementSibling as HTMLElement | null;
			$previous?.focus();
		} else if (e.key === 'ArrowDown') {
			const $next = target.nextElementSibling as HTMLElement | null;
			$next?.focus();
		}
	}

	private handleBeforeSelected(e: CustomEvent) {
		if (!e.target) return;

		const target = e.target as GlTreeItem;
		if (this._lastSelected != null && this._lastSelected !== target) {
			this._lastSelected.deselect();
		}
		this._lastSelected = target;
	}

	private handleSelected(e: CustomEvent<TreeItemSelectionDetail>) {
		if (!e.target || !e.detail.node.branch) return;

		function getParent(el: GlTreeItem) {
			const currentLevel = el.level;
			let prev = el.previousElementSibling as GlTreeItem | null;
			while (prev) {
				const prevLevel = prev.level;
				if (prevLevel < currentLevel) return prev;

				prev = prev.previousElementSibling as GlTreeItem | null;
			}

			return undefined;
		}

		const target = e.target as GlTreeItem;
		const level = target.level;
		let nextElement = target.nextElementSibling as GlTreeItem | null;
		while (nextElement) {
			if (level === nextElement.level) break;

			const parentElement = getParent(nextElement);
			nextElement.parentExpanded = parentElement?.expanded !== false;
			nextElement.expanded = e.detail.node.expanded;

			nextElement = nextElement.nextElementSibling as GlTreeItem;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-tree': GlTree;
	}
}
