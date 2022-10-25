import { css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { elementBase } from '../styles/base';

const template = html<TableContainer>`
	<template role="table">
		<div class="thead" role="rowgroup">
			<slot name="head"></slot>
		</div>
		<div class="tbody" role="rowgroup">
			<slot></slot>
		</div>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		display: table;
		border-collapse: collapse;
		width: 100%;
	}

	.thead {
		display: table-header-group;
		color: var(--table-heading);
	}

	.tbody {
		display: table-row-group;
		color: var(--table-text);
	}

	.tbody ::slotted(*:hover),
	.tbody ::slotted(*:focus-within) {
		background-color: var(--background-05);
	}
`;

@customElement({ name: 'table-container', template: template, styles: styles })
export class TableContainer extends FASTElement {}
