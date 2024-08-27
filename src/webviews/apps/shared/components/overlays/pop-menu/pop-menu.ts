import { css, html } from 'lit';
import { customElement, property, queryAssignedElements } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { GlElement } from '../../element';

const styles = css`
	:host {
		position: relative;
	}
	:host {
		box-sizing: border-box;
	}
	:host *,
	:host *::before,
	:host *::after {
		box-sizing: inherit;
	}
	[hidden] {
		display: none !important;
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

	slot[name='content'][position='left']::slotted(*) {
		left: 0;
	}

	slot[name='content'][position='right']::slotted(*) {
		right: 0;
	}

	slot[name='content']:not(.open)::slotted(*) {
		display: none;
	}
`;

@customElement('pop-menu')
export class PopMenu extends GlElement {
	static override readonly styles = [styles];

	@property({ type: Boolean })
	open = false;

	@property()
	position: 'left' | 'right' = 'left';

	@queryAssignedElements({ slot: 'trigger' })
	triggerNodes!: Array<HTMLElement>;

	@queryAssignedElements({ slot: 'content' })
	contentNodes!: Array<HTMLElement>;

	private isTrackingOutside = false;
	private _toggleHandler: ((e: MouseEvent) => void) | undefined;

	override connectedCallback() {
		super.connectedCallback();

		void this.updateToggle();
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

	handleToggle() {
		this.open = !this.open;
		void this.updateToggle();
	}

	async updateToggle() {
		await this.updateComplete;
		const triggerNode = this.triggerNodes[0];
		if (triggerNode != null) {
			triggerNode.ariaExpanded = this.open.toString();
		}
		const contentNode = this.contentNodes[0];
		if (this.open) {
			if (contentNode != null) {
				window.requestAnimationFrame(() => {
					contentNode?.focus();
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

	protected override render(): unknown {
		return html`
			<slot name="trigger"></slot>
			<slot
				name="content"
				position=${this.position}
				class=${classMap({
					open: this.open,
				})}
			></slot>
		`;
	}
}
