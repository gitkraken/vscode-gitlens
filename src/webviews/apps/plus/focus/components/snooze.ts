import { defineGkElement, Menu, MenuItem, Popover, Tooltip } from '@gitkraken/shared-web-components';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { pinStyles } from './common.css';
import { themeProperties } from './gk-theme.css';

const HOUR = 60 * 60 * 1000;

@customElement('gl-snooze')
class GlSnooze extends LitElement {
	static override styles = [themeProperties, pinStyles];

	@property({ reflect: true })
	public snoozed?: string;

	constructor() {
		super();

		defineGkElement(Menu, MenuItem, Popover, Tooltip);
	}

	override render() {
		if (this.snoozed) {
			return html`
				<gk-tooltip>
					<a href="#" class="icon pin is-active" slot="trigger" @click=${this.onUnsnoozeClick}
						><code-icon icon="bell"></code-icon
					></a>
					<span>Unsnooze</span>
				</gk-tooltip>
			`;
		}

		return html`
			<gk-popover placement="bottom-start">
				<a href="#" class="icon pin" slot="trigger"><code-icon icon="bell-slash"></code-icon></a>
				<gk-menu class="pin-menu" @select=${this.onSelectDuration}>
					<gk-menu-item data-value="unlimited">Snooze</gk-menu-item>
					<gk-menu-item data-value="1hr">Snooze for 1 hour</gk-menu-item>
					<gk-menu-item data-value="4hr">Snooze for 4 hours</gk-menu-item>
					<gk-menu-item data-value="tomorrow-9am">Snooze until tomorrow at 9:00 AM</gk-menu-item>
				</gk-menu>
			</gk-popover>
		`;
	}

	private onSnoozeActionCore(expiresAt?: string) {
		this.dispatchEvent(
			new CustomEvent('gl-snooze-action', {
				detail: { expiresAt: expiresAt, snooze: this.snoozed },
			}),
		);
	}

	onUnsnoozeClick(e: Event) {
		e.preventDefault();
		this.onSnoozeActionCore();
	}

	onSelectDuration(e: CustomEvent<{ target: MenuItem }>) {
		e.preventDefault();
		const duration = e.detail.target.dataset.value;
		if (!duration) return;

		if (duration === 'unlimited') {
			this.onSnoozeActionCore();
			return;
		}

		const now = new Date();
		let nowTime = now.getTime();
		switch (duration) {
			case '1hr':
				nowTime += HOUR;
				break;
			case '4hr':
				nowTime += HOUR * 4;
				break;
			case 'tomorrow-9am':
				now.setDate(now.getDate() + 1);
				now.setHours(9, 0, 0, 0);
				nowTime = now.getTime();
				break;
		}

		this.onSnoozeActionCore(new Date(nowTime).toISOString());
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-snooze': GlSnooze;
	}

	interface HTMLElementEventMap {
		'gl-snooze-action': CustomEvent<{ expiresAt: never; snooze: string } | { expiresAt?: string; snooze: never }>;
	}
}
