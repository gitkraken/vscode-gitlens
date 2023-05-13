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

	slot[name='content']::slotted(*)::before {
		font: normal normal normal 14px/1 codicon;
		display: inline-block;
		text-decoration: none;
		text-rendering: auto;
		text-align: center;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		user-select: none;
		-webkit-user-select: none;
		-ms-user-select: none;

		vertical-align: middle;
		line-height: 2rem;
		letter-spacing: normal;
		content: '\\ea76';
		position: absolute;
		top: 2px;
		right: 5px;
		cursor: pointer;
		pointer-events: all;
		z-index: 10001;
	}

	slot[name='content']::slotted(*) {
		position: absolute;
		top: 100%;
		z-index: 10000;
	}

	:host([position='left']) slot[name='content']::slotted(*) {
		left: 0;
	}

	:host([position='right']) slot[name='content']::slotted(*) {
		right: 0;
	}

	:host(:not([open])) slot[name='content']::slotted(*) {
		display: none;
	}
`;

@customElement({ name: 'pop-menu', template: template, styles: styles })
export class PopMenu extends FASTElement {
	@attr({ mode: 'boolean' })
	open = false;

	@attr()
	position: 'left' | 'right' = 'left';

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

	private isTrackingOutside = false;

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

	handleToggle(e: MouseEvent) {
		if (!e.composedPath().includes(this.triggerNode!)) return;

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
		if (
			!composedPath.includes(this) ||
			// If the ::before element is clicked and is the close icon, close the menu
			(e.type === 'click' &&
				window.getComputedStyle(composedPath[0] as Element, '::before').content === '"\uEA76"')
		) {
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
