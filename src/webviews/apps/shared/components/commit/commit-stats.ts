import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../code-icon';

const statToSymbol: readonly ['added' | 'modified' | 'removed', [string, string]][] = Object.freeze([
	['added', ['+', 'add']],
	['modified', ['~', 'edit']],
	['removed', ['-', 'trash']],
]);

@customElement('commit-stats')
export class CommitStats extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			flex-direction: row;
			align-items: center;
			gap: 1rem;
			white-space: nowrap;
			font-size: 1rem;
		}

		:host([symbol='icons']) {
			gap: 0.8rem;
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
		.removed {
			color: var(--vscode-gitDecoration-deletedResourceForeground);
		}

		.label {
			flex-basis: 100%;
			text-align: center;
			align-content: center;
			user-select: none;
		}

		.icon {
			--code-icon-size: 0.94017em;
			margin-inline-end: 0.2rem;
		}
	`;

	@property({ type: Number })
	added: number | undefined = 0;

	@property({ type: Number })
	modified: number | undefined = 0;

	@property({ type: Number })
	removed: number | undefined = 0;

	@property()
	symbol?: 'icons';

	override render() {
		return statToSymbol.map(([key, value]) => this.renderStat(key, value));
	}

	private renderStat(key: string, value: string[]) {
		const count = this[key as keyof CommitStats] as number | undefined;
		if (count == null) {
			return nothing;
		}

		return html`<span class="stat ${key}" aria-label="${count} ${key}"
			><span class="label">${this.renderSymbol(value)}${count}</span></span
		>`;
	}

	private renderSymbol([symbol, icon]: string[]) {
		if (this.symbol === 'icons') {
			return html`<code-icon class="icon" icon="${icon}"></code-icon>`;
		}
		return html`<span>${symbol}</span>`;
	}
}
