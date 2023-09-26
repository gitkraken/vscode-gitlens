import { ColorThemeKind, ThemeColor, ThemeIcon, window } from 'vscode';
import type { Colors } from '../../constants';
import type { RemoteProviderReference } from './remoteProvider';

export type IssueOrPullRequestType = 'issue' | 'pullrequest';
export type IssueOrPullRequestState = 'opened' | 'closed' | 'merged';

export interface IssueOrPullRequest {
	readonly type: IssueOrPullRequestType;
	readonly provider: RemoteProviderReference;
	readonly id: string;
	readonly title: string;
	readonly url: string;
	readonly date: Date;
	readonly closedDate?: Date;
	readonly closed: boolean;
	readonly state: IssueOrPullRequestState;
}

export interface IssueLabel {
	color: string;
	name: string;
}

export interface IssueMember {
	name: string;
	avatarUrl: string;
	url: string;
}

export interface IssueRepository {
	owner: string;
	repo: string;
}

export interface IssueShape extends IssueOrPullRequest {
	updatedDate: Date;
	author: IssueMember;
	assignees: IssueMember[];
	repository: IssueRepository;
	labels?: IssueLabel[];
	commentsCount?: number;
	thumbsUpCount?: number;
}

export interface SearchedIssue {
	issue: IssueShape;
	reasons: string[];
}

export function serializeIssueOrPullRequest(value: IssueOrPullRequest): IssueOrPullRequest {
	const serialized: IssueOrPullRequest = {
		type: value.type,
		provider: {
			id: value.provider.id,
			name: value.provider.name,
			domain: value.provider.domain,
			icon: value.provider.icon,
		},
		id: value.id,
		title: value.title,
		url: value.url,
		date: value.date,
		closedDate: value.closedDate,
		closed: value.closed,
		state: value.state,
	};
	return serialized;
}

export function getIssueOrPullRequestHtmlIcon(issue?: IssueOrPullRequest): string {
	if (issue == null) {
		return `<span class="codicon codicon-link" style="color:${
			window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
		};"></span>`;
	}

	if (issue.type === 'pullrequest') {
		switch (issue.state) {
			case 'merged':
				return `<span class="codicon codicon-git-merge" style="color:${
					window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
				};"></span>`;
			case 'closed':
				return `<span class="codicon codicon-git-pull-request-closed" style="color:${
					window.activeColorTheme.kind === ColorThemeKind.Dark ? '#f85149' : '#cf222e'
				};"></span>`;
			case 'opened':
				return `<span class="codicon codicon-git-pull-request" style="color:${
					window.activeColorTheme.kind === ColorThemeKind.Dark ? '#3fb950' : '#1a7f37'
				};"></span>`;
			default:
				return `<span class="codicon codicon-git-pull-request"></span>`;
		}
	} else {
		if (issue.closed) {
			return `<span class="codicon codicon-pass" style="color:${
				window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
			};"></span>`;
		}
		return `<span class="codicon codicon-issues" style="color:${
			window.activeColorTheme.kind === ColorThemeKind.Dark ? '#3fb950' : '#1a7f37'
		};"></span>`;
	}
}

export function getIssueOrPullRequestMarkdownIcon(issue?: IssueOrPullRequest): string {
	if (issue == null) {
		return `<span style="color:${
			window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
		};">$(link)</span>`;
	}

	if (issue.type === 'pullrequest') {
		switch (issue.state) {
			case 'merged':
				return `<span style="color:${
					window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
				};">$(git-merge)</span>`;
			case 'closed':
				return `<span style="color:${
					window.activeColorTheme.kind === ColorThemeKind.Dark ? '#f85149' : '#cf222e'
				};">$(git-pull-request-closed)</span>`;
			case 'opened':
				return `<span style="color:${
					window.activeColorTheme.kind === ColorThemeKind.Dark ? '#3fb950' : '#1a7f37'
				};">$(git-pull-request)</span>`;
			default:
				return `$(git-pull-request)`;
		}
	} else {
		if (issue.closed) {
			return `<span style="color:${
				window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
			};">$(pass)</span>`;
		}
		return `<span style="color:${
			window.activeColorTheme.kind === ColorThemeKind.Dark ? '#3fb950' : '#1a7f37'
		};">$(issues)</span>`;
	}
}

export function getIssueOrPullRequestThemeIcon(issue?: IssueOrPullRequest): ThemeIcon {
	if (issue == null) {
		return new ThemeIcon('link', new ThemeColor('gitlens.closedAutolinkedIssueIconColor' satisfies Colors));
	}

	if (issue.type === 'pullrequest') {
		switch (issue.state) {
			case 'merged':
				return new ThemeIcon(
					'git-merge',
					new ThemeColor('gitlens.mergedPullRequestIconColor' satisfies Colors),
				);
			case 'closed':
				return new ThemeIcon(
					'git-pull-request-closed',
					new ThemeColor('gitlens.closedPullRequestIconColor' satisfies Colors),
				);
			case 'opened':
				return new ThemeIcon(
					'git-pull-request',
					new ThemeColor('gitlens.openPullRequestIconColor' satisfies Colors),
				);
			default:
				return new ThemeIcon('git-pull-request');
		}
	} else {
		if (issue.closed) {
			return new ThemeIcon('pass', new ThemeColor('gitlens.closedAutolinkedIssueIconColor' satisfies Colors));
		}
		return new ThemeIcon('issues', new ThemeColor('gitlens.openAutolinkedIssueIconColor' satisfies Colors));
	}
}

export function serializeIssue(value: IssueShape): IssueShape {
	const serialized: IssueShape = {
		type: value.type,
		provider: {
			id: value.provider.id,
			name: value.provider.name,
			domain: value.provider.domain,
			icon: value.provider.icon,
		},
		id: value.id,
		title: value.title,
		url: value.url,
		date: value.date,
		closedDate: value.closedDate,
		closed: value.closed,
		state: value.state,
		updatedDate: value.updatedDate,
		author: {
			name: value.author.name,
			avatarUrl: value.author.avatarUrl,
			url: value.author.url,
		},
		repository: {
			owner: value.repository.owner,
			repo: value.repository.repo,
		},
		assignees: value.assignees.map(assignee => ({
			name: assignee.name,
			avatarUrl: assignee.avatarUrl,
			url: assignee.url,
		})),
		labels:
			value.labels == null
				? undefined
				: value.labels.map(label => ({
						color: label.color,
						name: label.name,
				  })),
		commentsCount: value.commentsCount,
		thumbsUpCount: value.thumbsUpCount,
	};
	return serialized;
}

export class Issue implements IssueShape {
	readonly type = 'issue';

	constructor(
		public readonly provider: RemoteProviderReference,
		public readonly id: string,
		public readonly title: string,
		public readonly url: string,
		public readonly date: Date,
		public readonly closed: boolean,
		public readonly state: IssueOrPullRequestState,
		public readonly updatedDate: Date,
		public readonly author: IssueMember,
		public readonly repository: IssueRepository,
		public readonly assignees: IssueMember[],
		public readonly closedDate?: Date,
		public readonly labels?: IssueLabel[],
		public readonly commentsCount?: number,
		public readonly thumbsUpCount?: number,
	) {}
}
