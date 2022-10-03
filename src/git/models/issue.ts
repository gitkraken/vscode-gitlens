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

export namespace IssueOrPullRequest {
	export function getHtmlIcon(issue: IssueOrPullRequest): string {
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

	export function getMarkdownIcon(issue: IssueOrPullRequest): string {
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

	export function getThemeIcon(issue: IssueOrPullRequest): ThemeIcon {
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
}
