import { isMac } from '@env/platform';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import './action-item';
import './action-nav';

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
		window.addEventListener('keydown', handleKeydown, false);
		window.addEventListener('keyup', handleKeyup, false);
		this.addEventListener('open-actions-menu', handleOpenMore);
		this._slotSubscriptionsDisposer = () => {
			window.removeEventListener('keydown', handleKeydown, false);
			window.removeEventListener('keyup', handleKeyup, false);
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

	private handleMoreActions(from: number, e: MouseEvent) {
		if (e.button !== 0) {
			return;
		}
		e.preventDefault();

		this.open = true;

		const event = new CustomEvent<{ items: ActionItemProps[] }>('open-actions-menu', {
			detail: {
				items: this.items.slice(from),
			},
		});
		this.dispatchEvent(event);

		const contextMenuEvent = new PointerEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			composed: true,
			view: window,
			button: 2,
			buttons: 2,
			clientX: this.getBoundingClientRect().right,
			clientY: this.getBoundingClientRect().bottom,
		});
		this.dispatchEvent(contextMenuEvent);

		const handleClick = () => {
			const ev = new CustomEvent('close-actions-menu');
			this.dispatchEvent(ev);
			this.open = false;
			window.removeEventListener('keyup', handleClick);
			window.removeEventListener('mousedown', handleClick);
			window.removeEventListener('mousemove', handleClick);
			window.removeEventListener('blur', handleClick);
		};
		setTimeout(() => {
			window.addEventListener('keyup', handleClick);
			window.addEventListener('mousedown', handleClick);
			window.addEventListener('mousemove', handleClick);
			window.addEventListener('blur', handleClick);
		});
	}

	private renderMoreOptions(from: number) {
		console.log('render action', this.open);
		return html`
			<action-item
				icon="more"
				?selected=${this.open}
				label="More actions..."
				href="#"
				@mousedown=${this.handleMoreActions.bind(this, from)}
				@click=${this.handleMoreActions}
			>
			</action-item>
		`;
	}

	override render() {
		const hasMore = this.items.length > this.limit;
		const splitValue = hasMore ? this.limit - 1 : this.items.length;
		return html`
			<action-nav>
				${this.items.slice(0, splitValue).map(({ modifiers, ...originalProps }) => {
					const { icon, label, href } = modifiers?.find(x => this.modifier === x.key) ?? originalProps;
					return html`<action-item icon=${icon} label=${label} href=${ifDefined(href)}></action-item>`;
				})}
				${when(hasMore, this.renderMoreOptions.bind(this, splitValue))}
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
