import { css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { elementBase } from '../styles/base';

const template = html<MenuList>`
	<template role="listbox">
		<slot></slot>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		width: max-content;
		background-color: var(--vscode-menu-background);
		border: 1px solid var(--vscode-menu-border);
	}
`;

@customElement({ name: 'menu-list', template: template, styles: styles })
export class MenuList extends FASTElement {}
