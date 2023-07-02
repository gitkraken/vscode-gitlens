import { css, customElement, FASTElement, html, observable, slotted } from '@microsoft/fast-element';
import type { FileChangeListItem } from './file-change-list-item';
import type { ListItem, ListItemSelectedEvent } from './list-item';

// Can only import types from 'vscode'
const BesideViewColumn = -2; /*ViewColumn.Beside*/

const template = html<ListContainer>`
	<template role="tree">
		<slot ${slotted('itemNodes')}></slot>
	</template>
`;

const styles = css`
	::slotted(*) {
		box-sizing: inherit;
	}
`;

type ListItemTypes = ListItem | FileChangeListItem;
@customElement({ name: 'list-container', template: template, styles: styles })
export class ListContainer extends FASTElement {
	private _lastSelected: ListItem | undefined;

	@observable
	itemNodes?: ListItemTypes[];

	itemNodesDisposer?: () => void;

	itemNodesChanged(_oldValue?: ListItemTypes[], newValue?: ListItemTypes[]) {
		this.itemNodesDisposer?.();

		if (!newValue?.length) {
			return;
		}

		const nodeEvents = newValue
			?.filter(node => node.nodeType === 1)
			.map(node => {
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

		this.itemNodesDisposer = () => {
			nodeEvents?.forEach(({ dispose }) => dispose());
		};
	}

	override disconnectedCallback() {
		this.itemNodesDisposer?.();
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
			nextElement.setAttribute('parentexpanded', parentElement?.expanded === false ? 'false' : 'true');
			nextElement.setAttribute('expanded', e.detail.expanded ? 'true' : 'false');
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
}
