import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { State } from '../../../commitDetails/protocol';
import { commitActionStyles } from './commit-action.css';
import '../../shared/components/overlays/popover';
import '../../shared/components/overlays/tooltip';

@customElement('gl-status-nav')
export class GlStatusNav extends LitElement {
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
				/* flex-wrap: wrap; */
				align-items: center;
				justify-content: space-between;
				gap: 0.2rem;
			}

			.tooltip--overflowed {
				min-width: 0;
			}

			.commit-action--overflowed {
				width: 100%;
			}

			.branch {
				min-width: 0;
				max-width: fit-content;
				white-space: nowrap;
				text-overflow: ellipsis;
				overflow: hidden;
			}

			.group {
				display: flex;
				flex: none;
				flex-direction: row;
				min-width: 0;
				max-width: 100%;
			}

			.group:first-child {
				min-width: 0;
				flex: 0 1 auto;
			}

			hr {
				border: none;
				border-top: 1px solid var(--color-foreground--25);
			}

			.md-code {
				background: var(--vscode-textCodeBlock-background);
				border-radius: 3px;
				padding: 0px 4px 2px 4px;
				font-family: var(--vscode-editor-font-family);
			}
		`,
	];

	@property({ type: Object })
	wip?: State['wip'];

	@property({ type: Object })
	preferences?: State['preferences'];

	override render() {
		if (this.wip == null) return nothing;

		const changes = this.wip.changes;
		const branch = this.wip.branch;
		if (changes == null || branch == null) return nothing;

		let prIcon = 'git-pull-request';
		if (this.wip.pullRequest?.state) {
			switch (this.wip.pullRequest?.state) {
				case 'merged':
					prIcon = 'git-merge';
					break;
				case 'closed':
					prIcon = 'git-pull-request-closed';
					break;
			}
		}

		return html`
			<div class="group">
				${when(
					this.wip.pullRequest != null,
					() =>
						html`<gl-popover hoist>
							<a href="#" class="commit-action" slot="anchor"
								><code-icon icon=${prIcon} class="pr pr--${this.wip!.pullRequest!.state}"></code-icon
								><span>#${this.wip!.pullRequest!.id}</span></a
							>
							<div slot="content">
								<issue-pull-request
									type="pr"
									name="${this.wip!.pullRequest!.title}"
									url="${this.wip!.pullRequest!.url}"
									identifier="#${this.wip!.pullRequest!.id}"
									status="${this.wip!.pullRequest!.state}"
									.date=${this.wip!.pullRequest!.updatedDate}
									.dateFormat="${this.preferences?.dateFormat}"
									.dateStyle="${this.preferences?.dateStyle}"
									details
								></issue-pull-request>
							</div>
						</gl-popover>`,
				)}
				<gl-tooltip hoist class="tooltip--overflowed">
					<a
						href="#"
						class="commit-action commit-action--overflowed"
						@click=${(e: MouseEvent) => this.handleAction(e, 'switch')}
					>
						${when(
							this.wip.pullRequest == null,
							() => html`<code-icon icon="git-branch"></code-icon>`,
						)}<span class="branch">${branch.name}</span><code-icon icon="chevron-down" size="10"></code-icon
					></a>
					<div slot="content">
						Switch to Another Branch...
						<hr />
						<code-icon icon="git-branch"></code-icon><span class="md-code">${this.wip.branch?.name}</span>
					</div>
				</gl-tooltip>
			</div>
			<div class="group">
				<gl-tooltip hoist content="Fetch">
					<a href="#" class="commit-action" @click=${(e: MouseEvent) => this.handleAction(e, 'fetch')}
						><code-icon icon="repo-fetch"></code-icon></a
				></gl-tooltip>
			</div>
		`;
	}

	handleAction(e: MouseEvent, action: string) {
		const altKey = e instanceof MouseEvent ? e.altKey : false;
		this.dispatchEvent(
			new CustomEvent(`gl-branch-action`, {
				detail: {
					action: action,
					alt: altKey,
				},
			}),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-status-nav': GlStatusNav;
	}
}
