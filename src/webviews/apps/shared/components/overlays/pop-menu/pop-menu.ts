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
	private _toggleHandler: ((e: MouseEvent) => void) | undefined;

	override connectedCallback() {
		super.connectedCallback();

		this.updateToggle();
		if (this._toggleHandler == null) {
			this._toggleHandler = this.handleToggle.bind(this);
		}
		this.addEventListener('click', this._toggleHandler, false);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();

		if (this._toggleHandler != null) {
			this.removeEventListener('click', this._toggleHandler, false);
			this._toggleHandler = undefined;
		}
		this.disposeTrackOutside();
	}

	close() {
		this.open = false;
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
			this.close();
		}
	}

	private _documentEventHandler: ((e: MouseEvent | FocusEvent) => void) | undefined;
	private _webviewBlurEventHandler: ((e: Event) => void) | undefined;

	trackOutside() {
		if (this.isTrackingOutside || !this.open) return;

		this.isTrackingOutside = true;
		if (this._documentEventHandler == null) {
			this._documentEventHandler = this.handleDocumentEvent.bind(this);
		}

		document.addEventListener('click', this._documentEventHandler, false);
		document.addEventListener('focusin', this._documentEventHandler, false);

		if (this._webviewBlurEventHandler == null) {
			this._webviewBlurEventHandler = () => this.close();
		}

		window.addEventListener('webview-blur', this._webviewBlurEventHandler, false);
	}

	disposeTrackOutside() {
		if (!this.isTrackingOutside) return;

		this.isTrackingOutside = false;

		if (this._documentEventHandler != null) {
			document.removeEventListener('click', this._documentEventHandler, false);
			window.removeEventListener('focusin', this._documentEventHandler, false);

			this._documentEventHandler = undefined;
		}

		if (this._webviewBlurEventHandler != null) {
			window.removeEventListener('webview-blur', this._webviewBlurEventHandler, false);

			this._webviewBlurEventHandler = undefined;
		}
	}
}
