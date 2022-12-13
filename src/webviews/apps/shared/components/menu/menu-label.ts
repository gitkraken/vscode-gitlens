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
		text-transform: uppercase;
		font-size: 0.84em;
		line-height: 2.2rem;
		padding-left: 0.6rem;
		padding-right: 0.6rem;
		margin: 0px;
	}
`;

@customElement({ name: 'menu-label', template: template, styles: styles })
export class MenuLabel extends FASTElement {}
