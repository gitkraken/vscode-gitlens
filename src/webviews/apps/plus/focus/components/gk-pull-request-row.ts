import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { PullRequestMember, PullRequestShape } from '../../../../../git/models/pullRequest';
import { elementBase } from '../../../shared/components/styles/lit/base.css';
import '@gitkraken/shared-web-components';

@customElement('gk-pull-request-row')
export class GkPullRequestRow extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				--gk-avatar-background-color: var(--background-10);
				--color-background: var(--vscode-editor-background);
				display: block;
			}

			p {
				margin: 0;
			}

			a {
				color: var(--vscode-textLink-foreground);
				text-decoration: none;
			}
			a:hover {
				text-decoration: underline;
			}
		`,
	];

	@property({ type: Number })
	public rank?: number;

	@property({ type: Object })
	public pullRequest?: PullRequestShape;

	@property({ type: Boolean })
	public isCurrentBranch = false;

	@property({ type: Boolean })
	public isCurrentWorktree = false;

	@property({ type: Boolean })
	public hasWorktree = false;

	@property({ type: Boolean })
	public hasLocalBranch = false;

	get lastUpdatedDate() {
		return new Date(this.pullRequest!.date);
	}

	get assignees() {
		const assignees = this.pullRequest?.assignees;
		if (assignees == null) {
			return [];
		}
		const author: PullRequestMember | undefined = this.pullRequest!.author;
		if (author != null) {
			return assignees.filter(assignee => assignee.name !== author.name);
		}

		return assignees;
	}

	override render() {
		if (!this.pullRequest) return undefined;

		return html`
			<gk-focus-row>
				<span slot="rank">${this.rank}</span>
				<gk-focus-item>
					<span slot="type"><code-icon icon="git-pull-request"></code-icon></span>
					<p>
						<strong
							>${this.pullRequest.title}
							<a href="${this.pullRequest.url}">#${this.pullRequest.id}</a></strong
						>
						<!-- &nbsp;
						<gk-badge>pending suggestions</gk-badge> -->
					</p>
					<p>
						<gk-tag>
							<span slot="prefix"><code-icon icon="source-control"></code-icon></span>
							${this.pullRequest.refs?.base.branch}
						</gk-tag>
						<gk-tag>
							<span slot="prefix"><code-icon icon="repo"></code-icon></span>
							${this.pullRequest.refs?.base.repo}
						</gk-tag>
						<gk-additions-deletions>
							<span slot="additions">${this.pullRequest.additions}</span>
							<span slot="deletions">${this.pullRequest.deletions}</span>
						</gk-additions-deletions>
					</p>
					<span slot="people">
						<gk-avatar-group>
							${when(
								this.pullRequest.author != null,
								() => html`<gk-avatar src="${this.pullRequest!.author.avatarUrl}"></gk-avatar>`,
							)}
							${when(
								this.assignees.length > 0,
								() => html`
									${repeat(
										this.assignees,
										item => item.url,
										(item, index) => html`<gk-avatar src="${item.avatarUrl}"></gk-avatar>`,
									)}
								`,
							)}
						</gk-avatar-group>
					</span>
					<span slot="date">
						<gk-date-from date="${this.lastUpdatedDate}"></gk-date-from>
					</span>
					<nav slot="actions"><gkc-button variant="ghost">Checkout branch</gkc-button></nav>
				</gk-focus-item>
			</gk-focus-row>
		`;
	}
}
