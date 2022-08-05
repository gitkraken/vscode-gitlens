import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../codicon';

@customElement('commit-stats')
export class CommitStats extends LitElement {
	static override styles = css`
        :host {
            display: inline-flex;
            flex-direction: row;
            align-items: center;
            gap: 0.5rem;
            vertical-align: middle;
        }

        .stat {
            display: inline-flex;
            flex-direction: row;
            align-items: center;
            min-width: 3.4em;
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
    }
    `;

	@property({ type: Number })
	added = 0;

	@property({ type: Number })
	modified = 0;

	@property({ type: Number })
	removed = 0;

	override render() {
		return html`
			<span class="stat added" title="${this.added} added" aria-label="${this.added} added"
				><code-icon icon="diff-added"></code-icon> ${this.added}</span
			>
			<span class="stat modified" title="${this.modified} modified" aria-label="${this.modified} modified"
				><code-icon icon="diff-modified"></code-icon> ${this.modified}</span
			>
			<span class="stat deleted" title="${this.removed} removed" aria-label="${this.removed} removed"
				><code-icon icon="diff-removed"></code-icon> ${this.removed}</span
			>
		`;
	}
}
