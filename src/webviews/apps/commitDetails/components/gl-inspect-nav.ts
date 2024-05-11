import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { State } from '../../../commitDetails/protocol';
import { commitActionStyles } from './commit-action.css';

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
	navigation?: State['navigationStack'];

	@property()
	shortSha = '';

	@property()
	stashNumber?: string;

	get navigationState() {
		if (this.navigation == null) {
			return {
				back: false,
				forward: false,
			};
		}

		const actions = {
			back: true,
			forward: true,
		};

		if (this.navigation.count <= 1) {
			actions.back = false;
			actions.forward = false;
		} else if (this.navigation.position === 0) {
			actions.back = true;
			actions.forward = false;
		} else if (this.navigation.position === this.navigation.count - 1) {
			actions.back = false;
			actions.forward = true;
		}

		return actions;
	}

	handleAction(e: Event) {
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

	fireEvent(type: string, detail?: Record<string, unknown>) {
		this.dispatchEvent(new CustomEvent(`gl-${type}`, { detail: detail }));
	}

	override render() {
		const pinLabel = this.pinned
			? html`Unpin this Commit<br />Restores Automatic Following`
			: html`Pin this Commit<br />Suspends Automatic Following`;

		let forwardLabel = 'Forward';
		let backLabel = 'Back';
		if (this.navigation?.hint) {
			if (!this.pinned) {
				forwardLabel += ` - ${this.navigation.hint}`;
			} else {
				backLabel += ` - ${this.navigation.hint}`;
			}
		}

		return html`
			<div class="group">
				${when(
					!this.uncommitted,
					() => html`
						<gl-tooltip hoist>
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
								>Copy ${this.stashNumber != null ? 'Stash Name' : 'SHA'}<br />[⌥] Copy Message</span
							>
						</gl-tooltip>
					`,
				)}
			</div>
			<div class="group">
				<gl-tooltip hoist
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
				<gl-tooltip hoist content="${backLabel}"
					><a
						class="commit-action${this.navigationState.back ? '' : ' is-disabled'}"
						aria-disabled="${this.navigationState.back ? 'false' : 'true'}"
						href="#"
						data-action="back"
						@click=${this.handleAction}
						><code-icon icon="arrow-left" data-region="commit-back"></code-icon></a
				></gl-tooltip>
				${when(
					this.navigationState.forward,
					() => html`
						<gl-tooltip hoist content="${forwardLabel}"
							><a class="commit-action" href="#" data-action="forward" @click=${this.handleAction}
								><code-icon icon="arrow-right" data-region="commit-forward"></code-icon></a
						></gl-tooltip>
					`,
				)}
				<!-- TODO: add a spacer -->
				${when(
					this.uncommitted,
					() => html`
						<gl-tooltip hoist content="Open SCM view"
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
				<gl-tooltip hoist content="Open in Commit Graph"
					><a
						class="commit-action"
						href="#"
						data-action="commit-actions"
						data-action-type="graph"
						@click=${this.handleAction}
						><code-icon icon="gl-graph"></code-icon></a
				></gl-tooltip>
				${when(
					!this.uncommitted,
					() => html`
						<gl-tooltip hoist content="Show Commit Actions"
							><a
								class="commit-action"
								href="#"
								data-action="commit-actions"
								data-action-type="more"
								@click=${this.handleAction}
								><code-icon icon="kebab-vertical"></code-icon></a
						></gl-tooltip>
					`,
				)}
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-inspect-nav': GlInspectNav;
	}
}
