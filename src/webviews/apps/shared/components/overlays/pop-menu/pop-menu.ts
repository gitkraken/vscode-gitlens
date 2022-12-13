import { attr, css, customElement, FASTElement, html, observable, slotted, volatile } from '@microsoft/fast-element';
import { hasNodes, nodeTypeFilter } from '../../helpers/slots';
import { elementBase } from '../../styles/base';

const template = html<PopMenu>`
	<template role="combobox">
		<slot ${slotted({ property: 'triggerNodes', filter: nodeTypeFilter(Node.ELEMENT_NODE) })} name="trigger"></slot>
		<slot ${slotted({ property: 'contentNodes', filter: nodeTypeFilter(Node.ELEMENT_NODE) })} name="content"></slot>
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		position: relative;
	}

	slot[name='content']::slotted(*) {
		position: absolute;
		left: 0;
		top: 100%;
		z-index: 10000;
	}

	:host(:not([open])) slot[name='content']::slotted(*) {
		display: none;
	}
`;

@customElement({ name: 'pop-menu', template: template, styles: styles })
export class PopMenu extends FASTElement {
	@attr({ mode: 'boolean' })
	open = false;

	@observable
	triggerNodes?: HTMLElement[];

	@observable
	contentNodes?: HTMLElement[];

	@volatile
	get triggerNode() {
		if (!hasNodes(this.triggerNodes)) {
			return;
		}

		return this.triggerNodes![0];
	}

	@volatile
	get contentNode() {
		if (!hasNodes(this.contentNodes)) {
			return;
		}

		return this.contentNodes![0];
	}

	isTrackingOutside = false;

	override connectedCallback() {
		super.connectedCallback();
		this.updateToggle();
		this.addEventListener('click', this.handleToggle.bind(this), false);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this.removeEventListener('click', this.handleToggle.bind(this), false);
		this.disposeTrackOutside();
	}

	handleToggle() {
		this.open = !this.open;
		this.updateToggle();
	}

	updateToggle() {
		if (this.triggerNode != null) {
			this.triggerNode.ariaExpanded = this.open.toString();
		}
		if (this.open) {
			if (this.contentNode != null) {
				window.requestAnimationFrame(() => {
					this.contentNode?.focus();
				});
			}
			this.trackOutside();
		}
	}

	handleDocumentEvent(e: MouseEvent | FocusEvent) {
		if (this.open === false) return;

		const composedPath = e.composedPath();
		if (!composedPath.includes(this)) {
			this.open = false;
			this.disposeTrackOutside();
		}
	}

	trackOutside() {
		if (this.isTrackingOutside || !this.open) return;

		this.isTrackingOutside = true;
		const boundHandleDocumentEvent = this.handleDocumentEvent.bind(this);
		document.addEventListener('click', boundHandleDocumentEvent, false);
		document.addEventListener('focusin', boundHandleDocumentEvent, false);
	}

	disposeTrackOutside() {
		if (!this.isTrackingOutside) return;

		this.isTrackingOutside = false;
		const boundHandleDocumentEvent = this.handleDocumentEvent.bind(this);
		document.removeEventListener('click', boundHandleDocumentEvent, false);
		window.removeEventListener('focusin', boundHandleDocumentEvent, false);
	}
}
