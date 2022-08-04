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
			<span class="stat added"><code-icon icon="diff-added"></code-icon> ${this.added}</span>
			<span class="stat modified"><code-icon icon="diff-modified"></code-icon> ${this.modified}</span>
			<span class="stat deleted"><code-icon icon="diff-removed"></code-icon> ${this.removed}</span>
		`;
	}
}
