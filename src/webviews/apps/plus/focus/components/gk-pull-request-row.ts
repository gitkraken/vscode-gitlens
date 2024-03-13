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
import { pinStyles, rowBaseStyles } from './common.css';
import { dateAgeStyles } from './date-styles.css';
import { themeProperties } from './gk-theme.css';
import { fromDateRange } from './helpers';
import './snooze';

@customElement('gk-pull-request-row')
export class GkPullRequestRow extends LitElement {
	static override styles = [
		themeProperties,
		elementBase,
		dateAgeStyles,
		repoBranchStyles,
		pinStyles,
		rowBaseStyles,
		css``,
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

	@property()
	public pinned?: string;

	@property()
	public snoozed?: string;

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
		return new Date(this.pullRequest!.updatedDate);
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

	get participants() {
		const participants: { member: PullRequestMember; roles: string[] }[] = [];
		function addMember(member: PullRequestMember, role: string) {
			const participant = participants.find(p => p.member.name === member.name);
			if (participant != null) {
				participant.roles.push(role);
			} else {
				participants.push({ member: member, roles: [role] });
			}
		}

		if (this.pullRequest?.author != null) {
			addMember(this.pullRequest.author, 'author');
		}

		if (this.pullRequest?.assignees != null) {
			this.pullRequest.assignees.forEach(m => addMember(m, 'assigned'));
		}

		if (this.pullRequest?.reviewRequests != null) {
			this.pullRequest.reviewRequests.forEach(m => addMember(m.reviewer, 'reviewer'));
		}

		return participants;
	}

	override render() {
		if (!this.pullRequest) return undefined;

		return html`
			<gk-focus-row>
				<span slot="pin">
					<gk-tooltip>
						<a
							href="#"
							class="icon pin ${this.pinned ? ' is-active' : ''}"
							slot="trigger"
							@click="${this.onPinClick}"
							><code-icon icon="pinned"></code-icon
						></a>
						<span>${this.pinned ? 'Unpin' : 'Pin'}</span>
					</gk-tooltip>
					<gl-snooze .snoozed=${this.snoozed} @gl-snooze-action=${this.onSnoozeAction}></gl-snooze>
				</span>
				<span slot="date">
					<gk-date-from class="date ${this.dateStyle}" date="${this.lastUpdatedDate}"></gk-date-from>
				</span>
				<span slot="key" class="key">
					${when(
						this.indicator === 'changes',
						() =>
							html`<gk-tooltip>
								<span class="icon" slot="trigger"
									><code-icon class="indicator-error" icon="request-changes"></code-icon
								></span>
								<span>changes requested</span>
							</gk-tooltip>`,
					)}
					${when(
						this.indicator === 'ready',
						() =>
							html`<gk-tooltip>
								<span class="icon" slot="trigger"
									><code-icon class="indicator-info" icon="pass"></code-icon
								></span>
								<span>approved and ready to merge</span>
							</gk-tooltip>`,
					)}
					${when(
						this.indicator === 'conflicting',
						() =>
							html`<gk-tooltip>
								<span class="icon" slot="trigger"
									><code-icon class="indicator-error" icon="bracket-error"></code-icon
								></span>
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
								${this.pullRequest.commentsCount}
							</gk-tag>
							<span>Comments</span>
						</gk-tooltip>
					</p>
					<span slot="people">
						<gk-avatar-group>
							${when(
								this.participants.length > 0,
								() => html`
									${repeat(
										this.participants,
										item => item.member.url,
										item =>
											html`<gk-avatar
												src="${item.member.avatarUrl}"
												title="${`${
													item.member.name ? `${item.member.name} ` : ''
												}(${item.roles.join(', ')})`}"
											></gk-avatar>`,
									)}
								`,
							)}
						</gk-avatar-group>
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
								aria-label="${this.isCurrentWorktree ? 'Already on this worktree' : 'Open Worktree...'}"
								@click="${this.onOpenWorktreeClick}"
								><code-icon icon="gl-worktrees-view"></code-icon
							></a>
							<span
								>${this.isCurrentWorktree ? 'Already on this worktree' : 'Open Worktree...'}</span
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

	onSnoozeAction(e: CustomEvent<{ expiresAt: never; snooze: string } | { expiresAt?: string; snooze: never }>) {
		e.preventDefault();
		this.dispatchEvent(
			new CustomEvent('snooze-item', {
				detail: {
					item: this.pullRequest!,
					expiresAt: e.detail.expiresAt,
					snooze: this.snoozed,
				},
			}),
		);
	}

	onPinClick(e: Event) {
		e.preventDefault();
		this.dispatchEvent(
			new CustomEvent('pin-item', {
				detail: { item: this.pullRequest!, pin: this.pinned },
			}),
		);
	}
}
