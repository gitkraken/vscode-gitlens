import { css, customElement, FASTElement, html, observable, slotted } from '@microsoft/fast-element';
import { nodeTypeFilter } from '../helpers/slots';
import { elementBase } from '../styles/base';

const template = html<AvatarStack>`<template>
	<slot ${slotted({ property: 'avatarNodes', filter: nodeTypeFilter(Node.ELEMENT_NODE) })}></slot>
</template>`;

const styles = css`
	${elementBase}

	:host {
		display: inline-flex;
		flex-direction: row;
		justify-content: center;
		align-items: center;
	}

	slot::slotted(*:not(:first-child)) {
		margin-left: calc(var(--avatar-size, 2.4rem) * -0.2);
	}

	:host(:focus-within) slot::slotted(*),
	:host(:hover) slot::slotted(*) {
		opacity: 0.5;
	}

	:host(:focus-within) slot::slotted(*:focus),
	:host(:hover) slot::slotted(*:hover) {
		opacity: 1;
		z-index: var(--avatar-selected-zindex, 1) !important;
	}
`;

@customElement({ name: 'avatar-stack', template: template, styles: styles })
export class AvatarStack extends FASTElement {
	zindex = 1;

	@observable
	avatarNodes?: HTMLElement[];

	avatarNodesChanged() {
		if (this.avatarNodes == null) return;

		const length = this.avatarNodes.length;
		if (length !== this.zindex - 1) {
			this.zindex = length + 1;
			this.style.setProperty('--avatar-selected-zindex', this.zindex.toString());
		}

		this.avatarNodes.forEach((el, i) => {
			el.style.zIndex = (length - i).toString();
		});
	}
}
