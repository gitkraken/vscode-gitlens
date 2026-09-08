import * as l10n from '@vscode/l10n';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { issueIconStyles } from './issue.css.js';
import '@gitlens/components/components/codeIcon.js';
import '@gitlens/components/components/overlays/tooltip.js';

@customElement('issue-icon')
export class IssueIcon extends LitElement {
	static override styles = [issueIconStyles];

	@property()
	state?: 'opened' | 'closed' | string;

	@property({ attribute: 'issue-id' })
	issueId?: string;

	get icon(): string {
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

	get classes(): string {
		if (!this.state) return 'issue-icon';

		return `issue-icon issue-icon--${this.state}`;
	}

	get label(): string {
		const state = this.state;
		if (!state) return l10n.t('Issue');

		if (this.issueId) {
			switch (state) {
				case 'opened':
					return l10n.t('Issue #{0} is opened', this.issueId);
				case 'closed':
					return l10n.t('Issue #{0} is closed', this.issueId);
				default:
					return l10n.t('Issue #{0}', this.issueId);
			}
		}

		switch (state) {
			case 'opened':
				return l10n.t('Issue is opened');
			case 'closed':
				return l10n.t('Issue is closed');
			default:
				return l10n.t('Issue');
		}
	}

	override render(): unknown {
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
