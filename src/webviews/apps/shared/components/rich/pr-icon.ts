import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { prIconStyles } from './pr.css';
import '../code-icon';

@customElement('pr-icon')
export class PrIcon extends LitElement {
	static override styles = [prIconStyles];

	@property()
	state?: 'merged' | 'opened' | 'closed' | string;

	get icon() {
		let prIcon = 'git-pull-request';
		if (this.state) {
			switch (this.state) {
				case 'merged':
					prIcon = 'git-merge';
					break;
				case 'closed':
					prIcon = 'git-pull-request-closed';
					break;
			}
		}
		return prIcon;
	}

	get classes() {
		if (!this.state) return 'pr-icon';

		return `pr-icon pr-icon--${this.state}`;
	}

	override render() {
		return html`<code-icon
			class=${this.classes}
			icon=${this.icon}
			aria-label=${ifDefined(this.state)}
		></code-icon>`;
	}
}
