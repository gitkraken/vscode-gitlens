import { css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { elementBase } from '../styles/base';

const template = html<TableRow>`
	<template role="row">
		<slot></slot>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		display: table-row;
	}
`;

@customElement({ name: 'table-row', template: template, styles: styles })
export class TableRow extends FASTElement {}
