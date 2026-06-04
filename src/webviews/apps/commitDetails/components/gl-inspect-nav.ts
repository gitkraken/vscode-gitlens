import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { getAltKeySymbol } from '@env/platform.js';
import type { NavigationState } from '../../shared/controllers/navigationStack.js';
import { commitActionStyles } from './commit-action.css.js';
import '../../shared/components/nav-buttons.js';

@customElement('gl-inspect-nav')
export class GlInspectNav extends LitElement {
	static override styles = [
		commitActionStyles,
		css`
			*,
			*::before,
			*::after {
				box-sizing: border-box;
			}

			:host {
				display: flex;
				flex-direction: row;
				flex-wrap: wrap;
				align-items: center;
				justify-content: space-between;
				gap: 0.2rem;
			}

			:host([pinned]) {
				background-color: var(--color-alert-warningBackground);
				box-shadow: 0 0 0 0.1rem var(--color-alert-warningBorder);
				color: var(--color-alert-warningForeground);
				border-radius: 0.3rem;
			}

			:host([pinned]) .commit-action:hover,
			:host([pinned]) .commit-action.is-active {
				background-color: var(--color-alert-warningHoverBackground);
			}

			.group {
				display: flex;
				flex: none;
				flex-direction: row;
				max-width: 100%;
			}

			.group:last-child {
				margin-inline-start: auto;
			}

			.sha {
				margin: 0 0.5rem 0 0.25rem;
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	pinned = false;

	@property({ type: Boolean })
	uncommitted = false;

	@property({ type: Object })
	navigation?: NavigationState;

	@property()
	shortSha = '';

	@property()
	stashNumber?: string;

	private handleAction(e: Event) {
		const targetEl = e.target as HTMLElement;
		const action = targetEl.dataset.action;
		if (action == null) return;

		if (action === 'commit-actions') {
			const altKey = e instanceof MouseEvent ? e.altKey : false;
			this.fireEvent('commit-actions', { action: targetEl.dataset.actionType, alt: altKey });
		} else {
			this.fireEvent(action);
		}
	}

	private fireEvent(type: string, detail?: Record<string, unknown>) {
		this.dispatchEvent(new CustomEvent(`gl-${type}`, { detail: detail }));
	}

	override render(): unknown {
		const pinLabel = this.pinned
			? html`Unpin this Commit<br />Restores Automatic Following`
			: html`Pin this Commit<br />Suspends Automatic Following`;

		return html`
			<div class="group">
				${when(
					!this.uncommitted,
					() => html`
						<gl-tooltip>
							<a
								class="commit-action"
								href="#"
								data-action="commit-actions"
								data-action-type="sha"
								@click=${this.handleAction}
							>
								<code-icon
									icon="${this.stashNumber != null ? 'gl-stashes-view' : 'git-commit'}"
								></code-icon>
								<span class="sha" data-region="shortsha"
									>${this.stashNumber != null ? `#${this.stashNumber}` : this.shortSha}</span
								>
							</a>
							<span slot="content"
								>Copy ${this.stashNumber != null ? 'Stash Name' : 'SHA'}<br />[${getAltKeySymbol()}]
								Copy Message</span
							>
						</gl-tooltip>
					`,
				)}
			</div>
			<div class="group">
				<gl-tooltip
					><a
						class="commit-action${this.pinned ? ' is-active' : ''}"
						href="#"
						data-action="pin"
						@click=${this.handleAction}
						><code-icon
							icon="${this.pinned ? 'gl-pinned-filled' : 'pin'}"
							data-region="commit-pin"
						></code-icon></a
					><span slot="content">${pinLabel}</span></gl-tooltip
				>
				<gl-nav-buttons .navigation=${this.navigation}></gl-nav-buttons>
				<!-- TODO: add a spacer -->
				${when(
					this.uncommitted,
					() => html`
						<gl-tooltip content="Open SCM view"
							><a
								class="commit-action"
								href="#"
								data-action="commit-actions"
								data-action-type="scm"
								@click=${this.handleAction}
								><code-icon icon="source-control"></code-icon></a
						></gl-tooltip>
					`,
				)}
				<gl-tooltip content="Open in Commit Graph"
					><a
						class="commit-action"
						href="#"
						data-action="commit-actions"
						data-action-type="graph"
						@click=${this.handleAction}
						><code-icon icon="gl-graph"></code-icon></a
				></gl-tooltip>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-inspect-nav': GlInspectNav;
	}
}
