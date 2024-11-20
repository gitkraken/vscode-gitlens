// import { isMac } from '@env/platform';
import { css, html, LitElement } from 'lit';
import { customElement, property, queryAssignedElements, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

const isMac = true;
import './action-item';
import './action-nav';
import { when } from 'lit/directives/when.js';
// import { isMac } from '@env/platform';

export interface ActionItemProps {
	icon: string;
	label: string;
	href?: string;
	modifiers?: { key: 'ctrl' | 'alt'; icon: string; label: string; href?: string }[];
}

@customElement('action-list')
export class ActionList extends LitElement {
	// static override styles = css``;

	private _slotSubscriptionsDisposer?: () => void;

	// override firstUpdated() {
	// 	this.role = 'navigation';
	// }

	@property({ type: Array })
	private items: Array<ActionItemProps> = [];

	@property({ type: Number })
	private limit: number = 3;

	@state()
	private modifier: 'ctrl' | 'alt' | undefined;

	override connectedCallback(): void {
		const handleKeydown = this.handleKeydown.bind(this);
		const handleKeyup = this.handleKeyup.bind(this);
		const handleOpenMore = this.handleOpenMore.bind(this);
		document.addEventListener('keydown', handleKeydown, false);
		document.addEventListener('keyup', handleKeyup, false);
		this.addEventListener('open-actions-menu', handleOpenMore);
		this._slotSubscriptionsDisposer = () => {
			document.removeEventListener('keydown', handleKeydown, false);
			document.removeEventListener('keyup', handleKeyup, false);
			this.removeEventListener('open-actions-menu', handleOpenMore);
		};
		super.connectedCallback();
	}

	override disconnectedCallback() {
		this._slotSubscriptionsDisposer?.();
		super.disconnectedCallback();
	}

	@state()
	private open = false;

	private renderMoreOptions() {
		return html`
			<gl-popover ?open=${this.open} trigger="manual">
				<action-item
					slot="anchor"
					icon="more"
					label="more"
					@click=${(e: MouseEvent) => {
						if (e.button !== 0) {
							return;
						}
						const event = new CustomEvent('open-actions-menu', { cancelable: true });
						this.dispatchEvent(event);
						if (event.defaultPrevented) {
							return;
						}
						this.open = !this.open;
						// const element = e.target as HTMLElement;
						// e.preventDefault();
						// const ev1 = new PointerEvent('contextmenu', {
						// 	bubbles: true,
						// 	cancelable: true,
						// 	composed: true,
						// 	view: window,
						// 	button: 2,
						// 	buttons: 2,
						// 	clientX: element.getBoundingClientRect().right,
						// 	clientY: element.getBoundingClientRect().bottom,
						// });
						// element.dispatchEvent(ev1);
					}}
				>
				</action-item>
				<menu-list slot="content">
					${this.items
						.slice(this.limit)
						.map(action => html` <menu-item href=${ifDefined(action.href)}>${action.label}</menu-item> `)}
				</menu-list>
			</gl-popover>
		`;
	}

	override render() {
		return html`
			<action-nav>
				${this.items.slice(0, this.limit).map(({ modifiers, ...originalProps }) => {
					const { icon, label, href } = modifiers?.find(x => this.modifier === x.key) ?? originalProps;
					return html`<action-item icon=${icon} label=${label} href=${ifDefined(href)}></action-item>`;
				})}
				${when(this.items.length >= this.limit, this.renderMoreOptions.bind(this))}
			</action-nav>
		`;
	}

	private handleOpenMore() {
		// this.open = !this.open;
	}

	private handleKeydown(e: KeyboardEvent) {
		if (this.modifier) {
			return;
		}
		if (e.key === 'Alt') {
			this.modifier = 'alt';
		} else if ((isMac && e.key === 'Meta') || (!isMac && e.key === 'Control')) {
			this.modifier = 'ctrl';
		}
	}

	private handleKeyup(e: KeyboardEvent) {
		if (!this.modifier) {
			return;
		}
		if (e.key === 'Alt' || (isMac && e.key === 'Meta') || (!isMac && e.key === 'Control')) {
			this.modifier = undefined;
		}
	}
}
