import type { ColorTheme } from 'vscode';
import { ColorThemeKind, ThemeColor, ThemeIcon, Uri, window } from 'vscode';
import type { IconPath } from '../../@types/vscode.iconpath';
import type { Colors } from '../../constants.colors';
import type { Container } from '../../container';
import { isLightTheme } from '../../system/vscode/utils';
import { getIconPathUris } from '../../system/vscode/vscode';
import type { GitBranch } from '../models/branch';
import type { IssueOrPullRequest } from '../models/issue';
import type { GitRemote } from '../models/remote';
import { getRemoteThemeIconString } from '../models/remote';
import type { Repository } from '../models/repository';
import type { GitStatus } from '../models/status';

export function getBranchIconPath(container: Container, branch: GitBranch | undefined): IconPath {
	switch (branch?.status) {
		case 'ahead':
		case 'behind':
		case 'diverged':
			return getIconPathUris(container, `icon-branch-${branch.status}.svg`);
		case 'upToDate':
			return getIconPathUris(container, `icon-branch-synced.svg`);
		default:
			return new ThemeIcon('git-branch');
	}
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

export function getRemoteIconPath(
	container: Container,
	remote: GitRemote | undefined,
	options?: { avatars?: boolean },
): IconPath {
	if (options?.avatars && remote?.provider?.icon != null) {
		return getIconPathUris(container, `icon-${remote.provider.icon}.svg`);
	}

	return new ThemeIcon(getRemoteThemeIconString(remote));
}

export function getRemoteIconUri(
	container: Container,
	remote: GitRemote,
	asWebviewUri?: (uri: Uri) => Uri,
	theme: ColorTheme = window.activeColorTheme,
): Uri | undefined {
	if (remote.provider?.icon == null) return undefined;

	const uri = Uri.joinPath(
		container.context.extensionUri,
		`images/${isLightTheme(theme) ? 'light' : 'dark'}/icon-${remote.provider.icon}.svg`,
	);
	return asWebviewUri != null ? asWebviewUri(uri) : uri;
}

export function getRepositoryStatusIconPath(
	container: Container,
	repository: Repository,
	status: GitStatus | undefined,
): IconPath {
	const type = repository.virtual ? '-cloud' : '';

	const branchStatus = status?.branchStatus;
	switch (branchStatus) {
		case 'ahead':
		case 'behind':
		case 'diverged':
			return getIconPathUris(container, `icon-repo-${branchStatus}${type}.svg`);
		case 'upToDate':
			if (status?.hasWorkingTreeChanges) {
				return getIconPathUris(container, `icon-repo-changes${type}.svg`);
			}
			return getIconPathUris(container, `icon-repo-synced${type}.svg`);
		default:
			if (status?.hasWorkingTreeChanges) {
				return getIconPathUris(container, `icon-repo-changes${type}.svg`);
			}
			return getIconPathUris(container, `icon-repo${type}.svg`);
	}
}

export function getWorktreeBranchIconPath(
	container: Container,
	branch: GitBranch | undefined,
	status?: GitStatus,
): IconPath {
	switch (branch?.status) {
		case 'ahead':
		case 'behind':
		case 'diverged':
			return getIconPathUris(container, `icon-repo-${branch.status}.svg`);
		case 'upToDate':
			if (status?.hasWorkingTreeChanges) {
				return getIconPathUris(container, `icon-repo-changes.svg`);
			}
			return getIconPathUris(container, `icon-repo-synced.svg`);
		default:
			if (status?.hasWorkingTreeChanges) {
				return getIconPathUris(container, `icon-repo-changes.svg`);
			}
			return getIconPathUris(container, `icon-repo.svg`);
	}
}
