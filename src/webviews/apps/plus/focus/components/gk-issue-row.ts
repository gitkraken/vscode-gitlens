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
import { dateAgeStyles } from './date-styles.css';
import { themeProperties } from './gk-theme.css';
import { fromDateRange } from './helpers';

@customElement('gk-issue-row')
export class GkIssueRow extends LitElement {
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

			.actions {
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
			.actions a:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}
			.actions a:hover {
				background-color: var(--vscode-toolbar-hoverBackground);
			}
			.actions a:active {
				background-color: var(--vscode-toolbar-activeBackground);
			}

			.actions a code-icon {
				font-size: 1.6rem;
			}
		`,
	];

	@property({ type: Number })
	public rank?: number;

	@property({ type: Object })
	public issue?: IssueShape;

	constructor() {
		super();

		defineGkElement(Tag, FocusRow, FocusItem, AvatarGroup, Avatar, RelativeDate, Tooltip);
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
				<span slot="key"></span>
				<gk-focus-item>
					<span slot="type"
						><code-icon icon="${this.issue.closed === true ? 'pass' : 'issues'}"></code-icon
					></span>
					<p>
						<strong>${this.issue.title} <a href="${this.issue.url}">#${this.issue.id}</a></strong>
						<!-- &nbsp;
						<gk-badge>pending suggestions</gk-badge> -->
					</p>
					<p>
						<gk-tag variant="ghost">
							<span slot="prefix"><code-icon icon="comment-discussion"></code-icon></span>
							${this.issue.commentsCount}
						</gk-tag>
						<gk-tag variant="ghost">
							<span slot="prefix"><code-icon icon="thumbsup"></code-icon></span>
							${this.issue.thumbsUpCount}
						</gk-tag>
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
					<span slot="date">
						<gk-date-from class="${this.dateStyle}" date="${this.lastUpdatedDate}"></gk-date-from>
					</span>
					<div slot="repo">
						<gk-tag variant="ghost" full>
							<span slot="prefix"><code-icon icon="repo"></code-icon></span>
							${this.issue.repository.repo}
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
}
