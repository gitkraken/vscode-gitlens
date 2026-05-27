import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { State } from '../../../commitDetails/protocol.js';
import { commitActionStyles } from './commit-action.css.js';
import '../../shared/components/overlays/popover.js';
import '../../shared/components/overlays/tooltip.js';

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

			.pr-pill {
				min-width: 0;
				overflow: hidden;
			}

			.pr-pill > code-icon {
				flex: none;
			}

			.pr-pill > span {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
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
	pullRequest?: PullRequestShape;

	@property({ type: Object })
	preferences?: State['preferences'];

	override render(): unknown {
		if (this.wip == null) return nothing;

		const changes = this.wip.changes;
		const branch = this.wip.branch;
		if (changes == null || branch == null) return nothing;

		let prIcon = 'git-pull-request';
		if (this.pullRequest?.state) {
			switch (this.pullRequest.state) {
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
					this.pullRequest != null,
					() =>
						html`<gl-popover hoist>
							<a href="#" class="commit-action pr-pill" slot="anchor"
								><code-icon icon=${prIcon} class="pr pr--${this.pullRequest!.state}"></code-icon
								><span>#${this.pullRequest!.id}</span></a
							>
							<div slot="content">
								<issue-pull-request
									type="pr"
									name="${this.pullRequest!.title}"
									url="${this.pullRequest!.url}"
									identifier="#${this.pullRequest!.id}"
									status="${this.pullRequest!.state}"
									.date=${this.pullRequest!.updatedDate}
									.dateFormat="${this.preferences?.dateFormat}"
									.dateStyle="${this.preferences?.dateStyle}"
									details
								></issue-pull-request>
							</div>
						</gl-popover>`,
				)}
				<gl-tooltip class="tooltip--overflowed">
					<a
						href="#"
						class="commit-action commit-action--overflowed"
						@click=${(e: MouseEvent) => this.handleAction(e, 'switch')}
					>
						${when(this.pullRequest == null, () => html`<code-icon icon="git-branch"></code-icon>`)}<span
							class="branch"
							>${branch.name}</span
						><code-icon icon="chevron-down" size="10"></code-icon
					></a>
					<div slot="content">
						Switch to Another Branch...
						<hr />
						<code-icon icon="git-branch"></code-icon><span class="md-code">${this.wip.branch?.name}</span>
					</div>
				</gl-tooltip>
			</div>
			<div class="group">
				<gl-tooltip content="Fetch">
					<a href="#" class="commit-action" @click=${(e: MouseEvent) => this.handleAction(e, 'fetch')}
						><code-icon icon="repo-fetch"></code-icon></a
				></gl-tooltip>
			</div>
		`;
	}

	private handleAction(e: MouseEvent, action: string) {
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
