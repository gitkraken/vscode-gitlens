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
				const selectHandler = this.handleSelected.bind(this);
				node.addEventListener('keydown', keyHandler, false);
				node.addEventListener('selected', selectHandler, false);

				return {
					dispose: function () {
						node?.removeEventListener('keydown', keyHandler, false);
						node?.addEventListener('selected', selectHandler, false);
					},
				};
			});

		this.itemNodesDisposer = () => {
			nodeEvents?.forEach(({ dispose }) => dispose());
		};
	}

	handleSelected(e: CustomEvent<ListItemSelectedDetail>) {
		this.$emit('selected', e.detail);
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
