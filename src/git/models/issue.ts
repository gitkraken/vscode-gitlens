import { ColorThemeKind, ThemeColor, ThemeIcon, window } from 'vscode';
import { Colors } from '../../constants';
import type { RemoteProviderReference } from './remoteProvider';

export const enum IssueOrPullRequestType {
	Issue = 'Issue',
	PullRequest = 'PullRequest',
}

export interface IssueOrPullRequest {
	readonly type: IssueOrPullRequestType;
	readonly provider: RemoteProviderReference;
	readonly id: string;
	readonly title: string;
	readonly url: string;
	readonly date: Date;
	readonly closedDate?: Date;
	readonly closed: boolean;
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
	};
	return serialized;
}

export function getIssueOrPullRequestHtmlIcon(issue: IssueOrPullRequest): string {
	if (issue.type === IssueOrPullRequestType.PullRequest) {
		if (issue.closed) {
			return `<span class="codicon codicon-git-pull-request" style="color:${
				window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
			};"></span>`;
		}
		return `<span class="codicon codicon-git-pull-request" style="color:${
			window.activeColorTheme.kind === ColorThemeKind.Dark ? '#3fb950' : '#1a7f37'
		};"></span>`;
	}

	if (issue.closed) {
		return `<span class="codicon codicon-pass" style="color:${
			window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
		};"></span>`;
	}
	return `<span class="codicon codicon-issues" style="color:${
		window.activeColorTheme.kind === ColorThemeKind.Dark ? '#3fb950' : '#1a7f37'
	};"></span>`;
}

export function getIssueOrPullRequestMarkdownIcon(issue: IssueOrPullRequest): string {
	if (issue.type === IssueOrPullRequestType.PullRequest) {
		if (issue.closed) {
			return `<span style="color:${
				window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
			};">$(git-pull-request)</span>`;
		}
		return `<span style="color:${
			window.activeColorTheme.kind === ColorThemeKind.Dark ? '#3fb950' : '#1a7f37'
		};">$(git-pull-request)</span>`;
	}

	if (issue.closed) {
		return `<span style="color:${
			window.activeColorTheme.kind === ColorThemeKind.Dark ? '#a371f7' : '#8250df'
		};">$(pass)</span>`;
	}
	return `<span style="color:${
		window.activeColorTheme.kind === ColorThemeKind.Dark ? '#3fb950' : '#1a7f37'
	};">$(issues)</span>`;
}

export function getIssueOrPullRequestThemeIcon(issue: IssueOrPullRequest): ThemeIcon {
	if (issue.type === IssueOrPullRequestType.PullRequest) {
		if (issue.closed) {
			return new ThemeIcon('git-pull-request', new ThemeColor(Colors.MergedPullRequestIconColor));
		}
		return new ThemeIcon('git-pull-request', new ThemeColor(Colors.OpenPullRequestIconColor));
	}

	if (issue.closed) {
		return new ThemeIcon('pass', new ThemeColor(Colors.ClosedAutolinkedIssueIconColor));
	}
	return new ThemeIcon('issues', new ThemeColor(Colors.OpenAutolinkedIssueIconColor));
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
	readonly type = IssueOrPullRequestType.Issue;

	constructor(
		public readonly provider: RemoteProviderReference,
		public readonly id: string,
		public readonly title: string,
		public readonly url: string,
		public readonly date: Date,
		public readonly closed: boolean,
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
