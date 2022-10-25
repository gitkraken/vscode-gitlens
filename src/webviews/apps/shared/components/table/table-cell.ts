import { attr, css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { elementBase } from '../styles/base';

const template = html<TableCell>`
	<template role="${x => x.cellRole}">
		<slot></slot>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		display: table-cell;
		vertical-align: top;
		padding: var(--table-spacing, 0.8rem);
		/* border-bottom: 1px solid var(--table-separator); */
		text-align: left;
	}

	:host(:first-child) {
		padding-left: var(--table-edge-spacing, 1.2rem);
	}
	:host(:last-child) {
		padding-right: var(--table-edge-spacing, 1.2rem);
	}

	:host([role='columnheader']) {
		text-transform: uppercase;
		font-weight: normal;
		padding-top: var(--table-heading-top-spacing, 0);
		padding-bottom: var(--table-heading-bottom-spacing, 1.2rem);
	}

	:host([pinned]) {
		background-color: var(--table-pinned-background);
		position: sticky;
		top: 0;
	}
`;

@customElement({ name: 'table-cell', template: template, styles: styles })
export class TableCell extends FASTElement {
	@attr
	header: 'column' | 'row' | '' = '';

	@attr({ mode: 'boolean' })
	pinned = false;

	get cellRole() {
		switch (this.header) {
			case 'column':
				return 'columnheader';
			case 'row':
				return 'rowheader';
			default:
				return 'cell';
		}
	}
}
