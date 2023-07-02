import { css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { elementBase } from '../styles/base';

const template = html<MenuLabel>`
	<template>
		<slot></slot>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		display: block;
		text-transform: uppercase;
		font-size: 0.84em;
		line-height: 2.2rem;
		padding-left: 0.6rem;
		padding-right: 0.6rem;
		margin: 0px;
		color: var(--vscode-menu-foreground);
		opacity: 0.6;
		user-select: none;
	}
`;

@customElement({ name: 'menu-label', template: template, styles: styles })
export class MenuLabel extends FASTElement {}
