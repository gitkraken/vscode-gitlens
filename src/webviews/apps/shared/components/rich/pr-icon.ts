import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { prIconStyles } from './pr.css.js';
import type { AutolinkIconStatus } from './utils.js';
import { getAutolinkIcon } from './utils.js';
import '../code-icon.js';
import '../overlays/tooltip.js';

@customElement('pr-icon')
export class PrIcon extends LitElement {
	static override styles = [prIconStyles];

	@property()
	state?: 'merged' | 'opened' | 'closed' | string;

	@property({ type: Boolean })
	draft = false;

	@property({ attribute: 'pr-id' })
	prId?: string;

	get icon(): string {
		// Stateless is NOT the resolver's job: its `status` defaults to 'merged', so handing it an absent
		// state would draw a merge glyph for a pull request whose state we simply don't know yet.
		if (!this.state) return this.draft ? 'git-pull-request-draft' : 'git-pull-request';

		return getAutolinkIcon('pr', this.state as AutolinkIconStatus, this.draft).icon;
	}

	get classes(): string {
		if (this.draft && this.state === 'opened') return 'pr-icon pr-icon--draft';
		if (!this.state) return 'pr-icon';

		return `pr-icon pr-icon--${this.state}`;
	}

	get label(): string {
		const type = this.draft ? 'Draft pull request' : 'Pull request';
		if (!this.state) return type;

		return `${type} ${this.prId ? `#${this.prId}` : ''} is ${this.state}`;
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
