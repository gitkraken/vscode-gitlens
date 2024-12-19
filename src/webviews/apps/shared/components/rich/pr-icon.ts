import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { prIconStyles } from './pr.css';
import '../code-icon';
import '../overlays/tooltip';

@customElement('pr-icon')
export class PrIcon extends LitElement {
	static override styles = [prIconStyles];

	@property()
	state?: 'merged' | 'opened' | 'closed' | string;

	@property({ type: Boolean })
	draft = false;

	@property({ attribute: 'pr-id' })
	prId?: string;

	get icon() {
		let prIcon = this.draft ? 'git-pull-request-draft' : 'git-pull-request';
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
		if (!this.state || (this.draft && this.state === 'opened')) {
			return 'pr-icon';
		}

		return `pr-icon pr-icon--${this.state}`;
	}

	get label() {
		const type = this.draft ? 'Draft pull request' : 'Pull request';
		if (!this.state) return type;

		return `${type} ${this.prId ? `#${this.prId}` : ''} is ${this.state}`;
	}

	override render() {
		if (!this.state) {
			return html`<code-icon
				class=${this.classes}
				icon=${this.icon}
				aria-label=${ifDefined(this.state)}
			></code-icon>`;
		}

		return html`<gl-tooltip>
			<code-icon class=${this.classes} icon=${this.icon} aria-label=${ifDefined(this.state)}></code-icon>
			<span slot="content">${this.label}</span>
		</gl-tooltip>`;
	}
}
