import {
	AdditionsDeletions,
	Avatar,
	AvatarGroup,
	defineGkElement,
	FocusItem,
	FocusRow,
	RelativeDate,
	Tag,
	Tooltip,
} from '@gitkraken/shared-web-components';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { PullRequestMember, PullRequestShape } from '../../../../../git/models/pullRequest';
import { elementBase } from '../../../shared/components/styles/lit/base.css';
import { repoBranchStyles } from './branch-tag.css';
import { dateAgeStyles } from './date-styles.css';
import { themeProperties } from './gk-theme.css';
import { fromDateRange } from './helpers';

@customElement('gk-pull-request-row')
export class GkPullRequestRow extends LitElement {
	static override styles = [
		themeProperties,
		elementBase,
		dateAgeStyles,
		repoBranchStyles,
		css`
			:host {
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
			a:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.actions gk-tooltip {
				display: inline-block;
			}

			.actions a {
				box-sizing: border-box;
				display: inline-flex;
				justify-content: center;
				align-items: center;
				width: 3.2rem;
				height: 3.2rem;
				border-radius: 0.5rem;
				color: inherit;
				padding: 0.2rem;
				vertical-align: text-bottom;
				text-decoration: none;
				cursor: pointer;
			}
			.actions a:hover {
				background-color: var(--vscode-toolbar-hoverBackground);
			}
			.actions a:active {
				background-color: var(--vscode-toolbar-activeBackground);
			}
			.actions a[tabindex='-1'] {
				opacity: 0.5;
				cursor: default;
			}

			.actions a code-icon {
				font-size: 1.6rem;
			}

			.indicator-info {
				color: var(--vscode-problemsInfoIcon-foreground);
			}
			.indicator-warning {
				color: var(--vscode-problemsWarningIcon-foreground);
			}
			.indicator-error {
				color: var(--vscode-problemsErrorIcon-foreground);
			}
			.indicator-neutral {
				color: var(--color-alert-neutralBorder);
			}

			.row-type {
				--gk-badge-outline-padding: 0.3rem 0.8rem;
				--gk-badge-font-size: 1.1rem;
				opacity: 0.5;
				vertical-align: middle;
			}

			.title {
				font-size: 1.4rem;
			}

			.add-delete {
				margin-left: 0.4rem;
				margin-right: 0.2rem;
			}

			.key {
				z-index: 1;
				position: relative;
			}

			.date {
				display: inline-block;
				min-width: 1.6rem;
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

	constructor() {
		super();

		// Tooltip typing isn't being properly recognized as `typeof GkElement`
		defineGkElement(
			Tag,
			FocusRow,
			FocusItem,
			AvatarGroup,
			Avatar,
			RelativeDate,
			AdditionsDeletions,
			Tooltip as any,
		);
	}

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

	get indicator() {
		if (this.pullRequest == null) return '';

		if (this.pullRequest.reviewDecision === 'ChangesRequested') {
			return 'changes';
		} else if (this.pullRequest.reviewDecision === 'Approved' && this.pullRequest.mergeableState === 'Mergeable') {
			return 'ready';
		} else if (this.pullRequest.mergeableState === 'Conflicting') {
			return 'conflicting';
		}

		return '';
	}

	get dateStyle() {
		return `indicator-${fromDateRange(this.lastUpdatedDate).status}`;
	}

	override render() {
		if (!this.pullRequest) return undefined;

		return html`
			<gk-focus-row>
				<span slot="key" class="key">
					${when(
						this.indicator === 'changes',
						() =>
							html`<gk-tooltip>
								<code-icon slot="trigger" class="indicator-error" icon="request-changes"></code-icon>
								<span>changes requested</span>
							</gk-tooltip>`,
					)}
					${when(
						this.indicator === 'ready',
						() =>
							html`<gk-tooltip>
								<code-icon slot="trigger" class="indicator-info" icon="pass"></code-icon>
								<span>approved and ready to merge</span>
							</gk-tooltip>`,
					)}
					${when(
						this.indicator === 'conflicting',
						() =>
							html`<gk-tooltip>
								<code-icon slot="trigger" class="indicator-error" icon="bracket-error"></code-icon>
								<span>cannot be merged due to merge conflicts</span>
							</gk-tooltip>`,
					)}
				</span>
				<gk-focus-item>
					<p>
						<span class="title"
							>${this.pullRequest.title}
							<a href="${this.pullRequest.url}">#${this.pullRequest.id}</a></span
						>
						<!-- &nbsp;
						<gk-badge>pending suggestions</gk-badge> -->
					</p>
					<p>
						<gk-badge variant="outline" class="row-type">PR</gk-badge>
						<gk-additions-deletions class="add-delete">
							<span slot="additions">${this.pullRequest.additions}</span>
							<span slot="deletions">${this.pullRequest.deletions}</span>
						</gk-additions-deletions>
						<gk-tooltip>
							<gk-tag variant="ghost" slot="trigger">
								<span slot="prefix"><code-icon icon="comment-discussion"></code-icon></span>
								${this.pullRequest.comments}
							</gk-tag>
							<span>Comments</span>
						</gk-tooltip>
					</p>
					<span slot="people">
						<gk-avatar-group>
							${when(
								this.pullRequest.author != null,
								() =>
									html`<gk-avatar
										src="${this.pullRequest!.author.avatarUrl}"
										title="${this.pullRequest!.author.name} (author)"
									></gk-avatar>`,
							)}
							${when(
								this.assignees.length > 0,
								() => html`
									${repeat(
										this.assignees,
										item => item.url,
										item =>
											html`<gk-avatar
												src="${item.avatarUrl}"
												title="${item.name ? `${item.name} (assignee)` : '(assignee)'}"
											></gk-avatar>`,
									)}
								`,
							)}
						</gk-avatar-group>
					</span>
					<span slot="date">
						<gk-date-from class="date ${this.dateStyle}" date="${this.lastUpdatedDate}"></gk-date-from>
					</span>
					<div slot="repo" class="repo-branch">
						<gk-tag class="repo-branch__tag" full @click=${this.onOpenBranchClick}>
							<span slot="prefix"><code-icon icon="source-control"></code-icon></span>
							${this.pullRequest.refs?.isCrossRepository === true
								? html`${this.pullRequest.refs?.head.owner}:${this.pullRequest.refs?.head.branch}`
								: this.pullRequest.refs?.head.branch}
						</gk-tag>
						<gk-tag variant="ghost" class="repo-branch__tag" full>
							<span slot="prefix"><code-icon icon="repo"></code-icon></span>
							${this.pullRequest.refs?.base.repo}
						</gk-tag>
					</div>
					<nav slot="actions" class="actions">
						<gk-tooltip>
							<a
								slot="trigger"
								href="#"
								tabindex="${this.isCurrentWorktree || this.isCurrentBranch ? -1 : nothing}"
								aria-label="${this.isCurrentWorktree ? 'Already on this workree' : 'Open Worktree...'}"
								@click="${this.onOpenWorktreeClick}"
								><code-icon icon="gl-worktrees-view"></code-icon
							></a>
							<span
								>${this.isCurrentWorktree ? 'Already on this workree' : 'Open Worktree...'}</span
							> </gk-tooltip
						><gk-tooltip>
							<a
								slot="trigger"
								href="#"
								tabindex="${this.hasWorktree || this.isCurrentBranch ? -1 : nothing}"
								aria-label="${this.isCurrentBranch
									? 'Already on this branch'
									: this.hasWorktree
									? 'This branch has a worktree'
									: 'Switch to Branch...'}"
								@click="${this.onSwitchBranchClick}"
								><code-icon icon="gl-switch"></code-icon
							></a>
							<span
								>${this.isCurrentBranch
									? 'Already on this branch'
									: this.hasWorktree
									? 'This branch has a worktree'
									: 'Switch to Branch...'}</span
							>
						</gk-tooltip>
					</nav>
				</gk-focus-item>
			</gk-focus-row>
		`;
	}

	onOpenBranchClick(_e: Event) {
		this.dispatchEvent(new CustomEvent('open-branch', { detail: this.pullRequest! }));
	}

	onOpenWorktreeClick(e: Event) {
		if (this.isCurrentWorktree) {
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
		this.dispatchEvent(new CustomEvent('open-worktree', { detail: this.pullRequest! }));
	}

	onSwitchBranchClick(e: Event) {
		if (this.isCurrentBranch || this.hasWorktree) {
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
		this.dispatchEvent(new CustomEvent('switch-branch', { detail: this.pullRequest! }));
	}
}
