import {
	Avatar,
	AvatarGroup,
	defineGkElement,
	FocusItem,
	FocusRow,
	RelativeDate,
	Tag,
	Tooltip,
} from '@gitkraken/shared-web-components';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { IssueMember, IssueShape } from '../../../../../git/models/issue';
import { elementBase } from '../../../shared/components/styles/lit/base.css';
import { repoBranchStyles } from './branch-tag.css';
import { pinStyles, rowBaseStyles } from './common.css';
import { dateAgeStyles } from './date-styles.css';
import { themeProperties } from './gk-theme.css';
import { fromDateRange } from './helpers';
import './snooze';

@customElement('gk-issue-row')
export class GkIssueRow extends LitElement {
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
	public issue?: IssueShape;

	@property()
	public pinned?: string;

	@property()
	public snoozed?: string;

	constructor() {
		super();

		// Tooltip typing isn't being properly recognized as `typeof GkElement`
		defineGkElement(Tag, FocusRow, FocusItem, AvatarGroup, Avatar, RelativeDate, Tooltip as any);
	}

	get lastUpdatedDate() {
		return new Date(this.issue!.date);
	}

	get dateStyle() {
		return `indicator-${fromDateRange(this.lastUpdatedDate).status}`;
	}

	get assignees() {
		const assignees = this.issue?.assignees;
		if (assignees == null) {
			return [];
		}
		const author: IssueMember | undefined = this.issue!.author;
		if (author != null) {
			return assignees.filter(assignee => assignee.avatarUrl !== author.avatarUrl);
		}

		return assignees;
	}

	override render() {
		if (!this.issue) return undefined;

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
				<span slot="key"></span>
				<gk-focus-item>
					<p>
						<span class="title">${this.issue.title} <a href="${this.issue.url}">#${this.issue.id}</a></span>
						<!-- &nbsp;
						<gk-badge>pending suggestions</gk-badge> -->
					</p>
					<p>
						<gk-badge variant="outline" class="row-type">Issue</gk-badge>
						<gk-tooltip
							><gk-tag variant="ghost" slot="trigger">
								<span slot="prefix"><code-icon icon="comment-discussion"></code-icon></span>
								${this.issue.commentsCount} </gk-tag
							><span>Comments</span></gk-tooltip
						>
						<gk-tooltip
							><gk-tag variant="ghost" slot="trigger">
								<span slot="prefix"><code-icon icon="thumbsup"></code-icon></span>
								${this.issue.thumbsUpCount} </gk-tag
							><span>Thumbs Up</span></gk-tooltip
						>
					</p>
					<span slot="people">
						<gk-avatar-group>
							${when(
								this.issue.author != null,
								() =>
									html`<gk-avatar
										src="${this.issue!.author.avatarUrl}"
										title="${this.issue!.author.name} (author)"
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
												title="${item.name ? `${item.name} ` : ''}(assignee)"
											></gk-avatar>`,
									)}
								`,
							)}
						</gk-avatar-group>
					</span>
					<div slot="repo">
						<gk-tag variant="ghost" full>
							<span slot="prefix"><code-icon icon="repo"></code-icon></span>
							${this.issue.repository?.repo}
						</gk-tag>
					</div>
					<nav slot="actions" class="actions">
						<gk-tooltip>
							<a slot="trigger" href="${this.issue.url}"><code-icon icon="globe"></code-icon></a>
							<span>Open issue on remote</span>
						</gk-tooltip>
					</nav>
				</gk-focus-item>
			</gk-focus-row>
		`;
	}

	onSnoozeAction(e: CustomEvent<{ expiresAt: never; snooze: string } | { expiresAt?: string; snooze: never }>) {
		e.preventDefault();
		this.dispatchEvent(
			new CustomEvent('snooze-item', {
				detail: {
					item: this.issue!,
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
				detail: { item: this.issue!, pin: this.pinned },
			}),
		);
	}
}
