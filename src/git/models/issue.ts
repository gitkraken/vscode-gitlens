import { ColorThemeKind, ThemeColor, ThemeIcon, window } from 'vscode';
import { Colors } from '../../constants';
import { RemoteProviderReference } from './remoteProvider';

export const enum IssueOrPullRequestType {
	Issue = 'Issue',
	PullRequest = 'PullRequest',
}

export interface IssueOrPullRequest {
	type: IssueOrPullRequestType;
	provider: RemoteProviderReference;
	id: string;
	date: Date;
	title: string;
	closed: boolean;
	closedDate?: Date;
	url: string;
}

export namespace IssueOrPullRequest {
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
		};">$(issue)</span>`;
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
