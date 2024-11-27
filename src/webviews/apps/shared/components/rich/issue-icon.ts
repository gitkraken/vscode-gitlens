import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { issueIconStyles } from './issue.css';
import '../code-icon';
import '../overlays/tooltip';

@customElement('issue-icon')
export class IssueIcon extends LitElement {
	static override styles = [issueIconStyles];

	@property()
	state?: 'opened' | 'closed' | string;

	@property({ attribute: 'issue-id' })
	issueId?: string;

	get icon() {
		let issueIcon = 'issues';
		if (this.state) {
			switch (this.state) {
				case 'opened':
					issueIcon = 'issues';
					break;
				case 'closed':
					issueIcon = 'pass';
					break;
			}
		}
		return issueIcon;
	}

	get classes() {
		if (!this.state) return 'issue-icon';

		return `issue-icon issue-icon--${this.state}`;
	}

	get label() {
		if (!this.state) return 'Issue';

		return `Issue ${this.issueId ? `#${this.issueId}` : ''} is ${this.state}`;
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
