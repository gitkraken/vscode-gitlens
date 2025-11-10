import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../code-icon';

const statToSymbol: readonly ['added' | 'modified' | 'removed', [string, string]][] = Object.freeze([
	['added', ['+', 'add']],
	['modified', ['~', 'edit']],
	['removed', ['-', 'remove']],
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

		:host([appearance='pill']) {
			background-color: color-mix(
				in srgb,
				var(--vscode-sideBarSectionHeader-background) 90%,
				var(--vscode-foreground) 10%
			);
			border: 1px solid
				color-mix(in srgb, var(--vscode-sideBarSectionHeader-border) 100%, var(--vscode-foreground) 70%);
			border-radius: 0.4rem;
			gap: 0;
			padding: 0 0.8rem 0 0.6rem;
			white-space: nowrap;
			line-height: 1.5rem;
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
			--code-icon-size: 0.9rem;
			margin-inline-end: 0.2rem;
		}

		/* Pill styles */
		:host([appearance='pill']) .stat {
			padding: 0;
			margin-inline-end: 0.8rem;
		}

		:host([appearance='pill']) .stat:last-child {
			margin-inline-end: 0;
		}

		:host([appearance='pill']) .icon {
			margin-inline-end: 0.3rem;
		}

		:host([appearance='pill']) .label {
			display: flex;
			align-items: center;
			gap: 0;
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

	@property({ reflect: true })
	appearance?: 'pill';

	override render(): unknown {
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
