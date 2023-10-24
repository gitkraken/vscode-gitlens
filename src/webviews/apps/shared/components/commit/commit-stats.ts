import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import '../code-icon';

@customElement('commit-stats')
export class CommitStats extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			flex-direction: row;
			align-items: center;
			gap: 1rem;
		}

		.stat {
			display: inline-flex;
			flex-direction: row;
			align-items: center;
		}

		.stat code-icon {
			margin-right: 0.25rem;
		}

		.added {
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}
		.modified {
			color: var(--vscode-gitDecoration-modifiedResourceForeground);
		}
		.deleted {
			color: var(--vscode-gitDecoration-deletedResourceForeground);
		}

		.label {
			flex-basis: 100%;
			text-align: center;
		}
	`;

	@property({ type: Number })
	added: number | undefined = 0;

	@property({ type: Number })
	modified: number | undefined = 0;

	@property({ type: Number })
	removed: number | undefined = 0;

	override render() {
		return html`
			${when(
				this.added != null,
				() =>
					html`<span class="stat added" title="${this.added} added" aria-label="${this.added} added"
						><span class="label">+${this.added}</span></span
					>`,
			)}
			${when(
				this.modified != null,
				() =>
					html`<span
						class="stat modified"
						title="${this.modified} modified"
						aria-label="${this.modified} modified"
						><span class="label">~${this.modified}</span></span
					>`,
			)}
			${when(
				this.removed != null,
				() =>
					html`<span class="stat deleted" title="${this.removed} removed" aria-label="${this.removed} removed"
						><span class="label">-${this.removed}</span></span
					>`,
			)}
		`;
	}
}
