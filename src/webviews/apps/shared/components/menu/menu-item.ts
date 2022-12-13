import { attr, css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { elementBase } from '../styles/base';

const template = html<MenuItem>`
	<template role="option" tabindex="${x => (x.disabled ? '-1' : '0')}" ?disabled="${x => x.disabled}">
		<slot></slot>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		font-family: inherit;
		border: none;
		padding: 0 0.6rem;
		cursor: pointer;
		color: var(--vscode-menu-foreground);
		background-color: var(--vscode-menu-background);
		text-align: left;
		display: flex;
		align-items: center;
		height: auto;
		line-height: 2.2rem;
	}

	:host(:hover) {
		color: var(--vscode-menu-selectionForeground);
		background-color: var(--vscode-menu-selectionBackground);
	}

	:host([disabled]) {
		pointer-events: none;
		cursor: default;
		opacity: 0.5;
	}

	:host([aria-selected='true']) {
		opacity: 1;
		color: var(--vscode-menu-selectionForeground);
		background-color: var(--vscode-menu-background);
	}
`;

@customElement({ name: 'menu-item', template: template, styles: styles })
export class MenuItem extends FASTElement {
	@attr({ mode: 'boolean' })
	disabled = false;
}
