import { attr, css, customElement, FASTElement, html, volatile } from '@microsoft/fast-element';
import { elementBase } from '../styles/base';

const template = html<MenuItem>`
	<template tabindex="${x => (x.isInteractive ? '0' : null)}" ?disabled="${x => x.disabled}">
		<slot></slot>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		display: block;
		font-family: inherit;
		border: none;
		padding: 0 0.6rem;
		cursor: pointer;
		color: var(--vscode-menu-foreground);
		background-color: var(--vscode-menu-background);
		text-align: left;
		height: auto;
		line-height: 2.2rem;
	}

	:host([role='option']:hover) {
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

	@attr
	override role: ARIAMixin['role'] = 'option';

	@volatile
	get isInteractive() {
		if (this.disabled) {
			return false;
		}

		return this.role === 'option';
	}
}
