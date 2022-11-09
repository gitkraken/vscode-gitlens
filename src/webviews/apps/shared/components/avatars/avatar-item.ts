import { attr, css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { focusOutline } from '../../../shared/components/styles/a11y';
import { elementBase } from '../../../shared/components/styles/base';

const template = html<AvatarItem>`<template role="img" tabindex="${x => x.tabIndex ?? '0'}">
	<slot></slot>
</template>`;

const styles = css`
	${elementBase}

	:host {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: var(--avatar-size, 2.4rem);
		aspect-ratio: 1 / 1;
		border-radius: 50%;
		border: 1px solid var(--color-background);
		background-color: var(--avatar-bg);
		background-position: center;
		background-repeat: no-repeat;
		background-size: cover;
		transition: all ease 200ms;
		font-size: calc(var(--avatar-size) * 0.42);
	}

	:host(:hover) {
		transform: scale(1.2);
	}

	:host(:focus-visible) {
		${focusOutline}
	}
`;

@customElement({ name: 'avatar-item', template: template, styles: styles })
export class AvatarItem extends FASTElement {
	@attr
	media = '';

	@attr({ mode: 'boolean' })
	static = false;

	override attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
		super.attributeChangedCallback(name, oldValue, newValue);

		if (name !== 'media' || oldValue === newValue) {
			return;
		}

		this.style.backgroundImage = `url(${this.media})`;
	}
}
