import { css, customElement, FASTElement, html, observable, slotted } from '@microsoft/fast-element';
import type { FileChangeListItem } from './file-change-list-item';
import type { ListItem, ListItemSelectedDetail } from './list-item';

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

	handleBeforeSelected(e: Event) {
		if (!e.target) return;

		const target = e.target as ListItem;
		if (this._lastSelected != null && this._lastSelected !== target) {
			this._lastSelected.deselect();
		}
		this._lastSelected = target;
	}

	handleSelected(e: CustomEvent<ListItemSelectedDetail>) {
		if (!e.target || !e.detail.branch) return;

		const target = e.target as ListItem;
		const level = target.getAttribute('level');

		const getLevel = (el: ListItem) => parseInt(el.getAttribute('level') ?? '0', 10);
		const getParent = (el: ListItem) => {
			const level = getLevel(el);
			let prev = el.previousElementSibling;
			while (prev) {
				const prevLevel = getLevel(prev as ListItem);
				if (prevLevel < level) {
					return prev as ListItem;
				}
				prev = prev.previousElementSibling;
			}

			return undefined;
		};
		let nextElement = target.nextElementSibling as ListItem;
		while (nextElement) {
			if (nextElement.getAttribute('level') === level) {
				break;
			}
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
			target.select(e.key === 'Enter' ? { preserveFocus: false } : undefined);
		} else if (e.key === 'ArrowUp') {
			const $previous: HTMLElement | null = target.previousElementSibling as HTMLElement;
			$previous?.focus();
		} else if (e.key === 'ArrowDown') {
			const $next: HTMLElement | null = target.nextElementSibling as HTMLElement;
			$next?.focus();
		}
	}
}
