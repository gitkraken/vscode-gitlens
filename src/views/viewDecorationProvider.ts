import type { CancellationToken, Event, FileDecoration, FileDecorationProvider } from 'vscode';
import { Disposable, EventEmitter, ThemeColor, Uri, window } from 'vscode';
import { getQueryDataFromScmGitUri } from '../@types/vscode.git.uri';
import type { Colors } from '../constants';
import { GlyphChars, Schemes } from '../constants';
import type { GitBranchStatus } from '../git/models/branch';

export class ViewFileDecorationProvider implements FileDecorationProvider, Disposable {
	private readonly _onDidChange = new EventEmitter<undefined | Uri | Uri[]>();
	get onDidChange(): Event<undefined | Uri | Uri[]> {
		return this._onDidChange.event;
	}

	private readonly disposable: Disposable;
	constructor() {
		this.disposable = Disposable.from(
			// Register the current branch decorator separately (since we can only have 2 char's per decoration)
			window.registerFileDecorationProvider({
				provideFileDecoration: (uri, token) => {
					if (uri.scheme !== 'gitlens-view') return undefined;

					if (uri.authority === 'branch') {
						return this.provideBranchCurrentDecoration(uri, token);
					}

					if (uri.authority === 'remote') {
						return this.provideRemoteDefaultDecoration(uri, token);
					}

					if (uri.authority === 'workspaces') {
						return this.provideWorkspaceDecoration(uri, token);
					}

					return undefined;
				},
			}),
			window.registerFileDecorationProvider(this),
		);
	}

	dispose(): void {
		this.disposable.dispose();
	}

	provideWorkspaceDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
		const [, type, status] = uri.path.split('/');
		if (type === 'repository') {
			if (status === 'open') {
				return {
					badge: '●',
					color: new ThemeColor('gitlens.decorations.workspaceRepoOpenForegroundColor' satisfies Colors),
					tooltip: '',
				};
			}

			if (status === 'missing') {
				return {
					badge: '?',
					color: new ThemeColor('gitlens.decorations.workspaceRepoMissingForegroundColor' satisfies Colors),
					tooltip: '',
				};
			}
		}

		if (type === 'workspace') {
			if (status === 'current') {
				return {
					badge: '●',
					color: new ThemeColor('gitlens.decorations.workspaceCurrentForegroundColor' satisfies Colors),
					tooltip: '',
				};
			}
		}

		return undefined;
	}

	provideFileDecoration(uri: Uri, token: CancellationToken): FileDecoration | undefined {
		if (uri.scheme === Schemes.Git) {
			const data = getQueryDataFromScmGitUri(uri);
			if (data?.decoration != null) {
				uri = Uri.parse(data?.decoration);
			}
		}
		if (uri.scheme !== 'gitlens-view') return undefined;

		switch (uri.authority) {
			case 'branch':
				return this.provideBranchStatusDecoration(uri, token);
			case 'commit-file':
				return this.provideCommitFileStatusDecoration(uri, token);
		}

		return undefined;
	}

	provideCommitFileStatusDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
		const [, , status] = uri.path.split('/');

		switch (status) {
			case '!':
				return {
					badge: 'I',
					color: new ThemeColor('gitlens.decorations.ignoredForegroundColor' satisfies Colors),
					tooltip: 'Ignored',
				};
			case '?':
				return {
					badge: 'U',
					color: new ThemeColor('gitlens.decorations.untrackedForegroundColor' satisfies Colors),
					tooltip: 'Untracked',
				};
			case 'A':
				return {
					badge: 'A',
					color: new ThemeColor('gitlens.decorations.addedForegroundColor' satisfies Colors),
					tooltip: 'Added',
				};
			case 'C':
				return {
					badge: 'C',
					color: new ThemeColor('gitlens.decorations.copiedForegroundColor' satisfies Colors),
					tooltip: 'Copied',
				};
			case 'D':
				return {
					badge: 'D',
					color: new ThemeColor('gitlens.decorations.deletedForegroundColor' satisfies Colors),
					tooltip: 'Deleted',
				};
			case 'M':
				return {
					badge: 'M',
					// Commented out until we can control the color to only apply to the badge, as the color is applied to the entire decoration and its too much
					// https://github.com/microsoft/vscode/issues/182098
					// color: new ThemeColor('gitlens.decorations.modifiedForegroundColor' satisfies Colors),
					tooltip: 'Modified',
				};
			case 'R':
				return {
					badge: 'R',
					color: new ThemeColor('gitlens.decorations.renamedForegroundColor' satisfies Colors),
					tooltip: 'Renamed',
				};
			default:
				return undefined;
		}
	}

	provideBranchStatusDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
		const [, , status] = uri.path.split('/');

		switch (status as GitBranchStatus) {
			case 'ahead':
				return {
					badge: '▲',
					color: new ThemeColor('gitlens.decorations.branchAheadForegroundColor' satisfies Colors),
					tooltip: 'Ahead',
				};
			case 'behind':
				return {
					badge: '▼',
					color: new ThemeColor('gitlens.decorations.branchBehindForegroundColor' satisfies Colors),
					tooltip: 'Behind',
				};
			case 'diverged':
				return {
					badge: '▼▲',
					color: new ThemeColor('gitlens.decorations.branchDivergedForegroundColor' satisfies Colors),
					tooltip: 'Diverged',
				};
			case 'missingUpstream':
				return {
					badge: '!',
					color: new ThemeColor('gitlens.decorations.branchMissingUpstreamForegroundColor' satisfies Colors),
					tooltip: 'Missing Upstream',
				};
			case 'upToDate':
				return {
					badge: '',
					color: new ThemeColor('gitlens.decorations.branchUpToDateForegroundColor' satisfies Colors),
					tooltip: 'Up to Date',
				};
			case 'unpublished':
				return {
					badge: '▲+',
					color: new ThemeColor('gitlens.decorations.branchUnpublishedForegroundColor' satisfies Colors),
					tooltip: 'Unpublished',
				};
			default:
				return undefined;
		}
	}

	provideBranchCurrentDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
		const [, , status, current] = uri.path.split('/');

		if (!current) return undefined;

		let color;
		switch (status as GitBranchStatus) {
			case 'ahead':
				color = new ThemeColor('gitlens.decorations.branchAheadForegroundColor' satisfies Colors);
				break;
			case 'behind':
				color = new ThemeColor('gitlens.decorations.branchBehindForegroundColor' satisfies Colors);
				break;
			case 'diverged':
				color = new ThemeColor('gitlens.decorations.branchDivergedForegroundColor' satisfies Colors);
				break;
			case 'upToDate':
				color = new ThemeColor('gitlens.decorations.branchUpToDateForegroundColor' satisfies Colors);
				break;
			case 'unpublished':
				color = new ThemeColor('gitlens.decorations.branchUnpublishedForegroundColor' satisfies Colors);
				break;
		}

		return {
			badge: GlyphChars.Check,
			color: color,
			tooltip: 'Current Branch',
		};
	}

	provideRemoteDefaultDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
		const [, isDefault] = uri.path.split('/');

		if (!isDefault) return undefined;

		return {
			badge: GlyphChars.Check,
			tooltip: 'Default Remote',
		};
	}
}
