import { css, customElement, FASTElement, html, ref } from '@microsoft/fast-element';
import { focusOutline, srOnly } from '../../../shared/components/styles/a11y';
import { elementBase } from '../../../shared/components/styles/base';

import '../../../shared/components/table/table-cell';

const template = html<WorkspaceItem>`
	<template role="row" @click="${(x, c) => x.selectRow(c.event)}">
		<table-cell class="sr-only">
			<button type="button">select workspace</button>
		</table-cell>
		<table-cell>
			<slot name="name"></slot>
		</table-cell>
		<table-cell>
			<slot name="description"></slot>
		</table-cell>
		<table-cell ${ref('count')}>
			<slot name="count"></slot>
		</table-cell>
		<table-cell>
			<slot name="updated"></slot>
		</table-cell>
		<table-cell ${ref('shared')}>
			<slot name="shared"></slot>
		</table-cell>
		<table-cell>
			<slot name="owner"></slot>
		</table-cell>
		<table-cell class="actions" ${ref('actions')}>
			<slot name="actions"></slot>
		</table-cell>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		display: table-row;
		cursor: pointer;
	}

	:host(:focus) {
		${focusOutline}
	}

	.actions {
		text-align: right;
	}

	${srOnly}
`;

@customElement({ name: 'workspace-item', template: template, styles: styles, shadowOptions: { delegatesFocus: true } })
export class WorkspaceItem extends FASTElement {
	actions!: HTMLElement;
	count!: HTMLElement;
	shared!: HTMLElement;

	selectRow(e: Event) {
		const path = e.composedPath();
		// exclude events triggered from a slot with actions
		if ([this.actions, this.count, this.shared].find(el => path.indexOf(el) > 0) !== undefined) {
			return;
		}

		console.log('WorkspaceItem.selectRow', e, path);
		this.$emit('selected');
	}
}
