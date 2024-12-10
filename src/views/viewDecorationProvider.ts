import type { CancellationToken, Event, FileDecoration, FileDecorationProvider } from 'vscode';
import { Disposable, EventEmitter, ThemeColor, Uri, window } from 'vscode';
import { getQueryDataFromScmGitUri } from '../@types/vscode.git.uri';
import { GlyphChars, Schemes } from '../constants';
import type { Colors } from '../constants.colors';
import type { GitBranchStatus } from '../git/models/branch';
import type { GitFileStatus } from '../git/models/file';

export class ViewFileDecorationProvider implements FileDecorationProvider, Disposable {
	private readonly _onDidChange = new EventEmitter<undefined | Uri | Uri[]>();
	get onDidChange(): Event<undefined | Uri | Uri[]> {
		return this._onDidChange.event;
	}

	private readonly disposable: Disposable;
	constructor() {
		this.disposable = Disposable.from(window.registerFileDecorationProvider(this));
	}

	dispose(): void {
		this.disposable.dispose();
	}

	provideFileDecoration(uri: Uri, token: CancellationToken): FileDecoration | undefined {
		if (uri.scheme === Schemes.Git) {
			const data = getQueryDataFromScmGitUri(uri);
			if (data?.decoration != null) {
				uri = Uri.parse(data?.decoration);
			}
		}

		return provideViewNodeDecoration(uri, token);
	}
}

function provideViewNodeDecoration(uri: Uri, token: CancellationToken): FileDecoration | undefined {
	if (uri.scheme !== 'gitlens-view') return undefined;

	switch (uri.authority) {
		case 'branch':
			return getBranchDecoration(uri, token);
		case 'commit-file':
			return getCommitFileStatusDecoration(uri, token);
		case 'remote':
			return getRemoteDecoration(uri, token);
		case 'repositories':
			return getRepositoriesDecoration(uri, token);
		case 'repository':
			return getRepositoryDecoration(uri, token);
		case 'status':
			return getStatusDecoration(uri, token);
		case 'workspace':
			return getWorkspaceDecoration(uri, token);
		case 'worktree':
			return getWorktreeDecoration(uri, token);
	}

	return undefined;
}

interface BranchViewDecoration {
	status: GitBranchStatus | 'unpublished';
	current?: boolean;
	starred?: boolean;
	worktree?: { opened: boolean };
	showStatusOnly?: boolean;
}

function getBranchDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
	const state = getViewDecoration<'branch'>(uri);

	let decoration: FileDecoration;

	switch (state?.status) {
		case 'ahead':
			decoration = {
				badge: '\u00a0\u00a0',
				color: new ThemeColor('gitlens.decorations.branchAheadForegroundColor' satisfies Colors),
				tooltip: 'Ahead',
			};
			break;
		case 'behind':
			decoration = {
				badge: '\u00a0\u00a0',
				color: new ThemeColor('gitlens.decorations.branchBehindForegroundColor' satisfies Colors),
				tooltip: 'Behind',
			};
			break;
		case 'diverged':
			decoration = {
				badge: '\u00a0\u00a0',
				color: new ThemeColor('gitlens.decorations.branchDivergedForegroundColor' satisfies Colors),
				tooltip: 'Diverged',
			};
			break;
		case 'missingUpstream':
			decoration = {
				badge: GlyphChars.Warning,
				color: new ThemeColor('gitlens.decorations.branchMissingUpstreamForegroundColor' satisfies Colors),
				tooltip: 'Missing Upstream',
			};
			break;
		case 'upToDate':
			decoration = {
				badge: '\u00a0\u00a0',
				color: new ThemeColor('gitlens.decorations.branchUpToDateForegroundColor' satisfies Colors),
				tooltip: 'Up to Date',
			};
			break;
		case 'unpublished':
			decoration = {
				badge: '\u00a0\u00a0',
				color: new ThemeColor('gitlens.decorations.branchUnpublishedForegroundColor' satisfies Colors),
				tooltip: 'Unpublished',
			};
			break;
		default:
			decoration = { badge: '\u00a0\u00a0' };
			break;
	}

	if (state?.showStatusOnly) return decoration;

	if (state?.current) {
		return {
			...decoration,
			badge: GlyphChars.Bullseye,
			tooltip: 'Current',
		};
	}

	if (state?.worktree?.opened) {
		return {
			...decoration,
			badge: '●',
			tooltip: 'Opened Worktree',
		};
	}

	if (state?.starred) {
		return {
			...decoration,
			badge: '★',
			tooltip: 'Favorited',
		};
	}

	return decoration;
}

interface CommitFileViewDecoration {
	status: GitFileStatus;
}

function getCommitFileStatusDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
	const state = getViewDecoration<'commit-file'>(uri);

	switch (state?.status) {
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
	}

	return undefined;
}

interface RemoteViewDecoration {
	default?: boolean;
}

function getRemoteDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
	const state = getViewDecoration<'remote'>(uri);

	if (state?.default) {
		return {
			badge: GlyphChars.Check,
			tooltip: 'Default Remote',
		};
	}

	return undefined;
}

interface StatusViewDecoration {
	status: 'merging' | 'rebasing';
	conflicts?: boolean;
}

function getStatusDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
	const state = getViewDecoration<'status'>(uri);

	switch (state?.status) {
		case 'rebasing':
		case 'merging':
			if (state?.conflicts) {
				return {
					badge: '!',
					color: new ThemeColor(
						'gitlens.decorations.statusMergingOrRebasingConflictForegroundColor' satisfies Colors,
					),
				};
			}

			return {
				color: new ThemeColor('gitlens.decorations.statusMergingOrRebasingForegroundColor' satisfies Colors),
			};
	}

	return undefined;
}

interface RepositoriesViewDecoration {
	currentWorkspace?: boolean;
}

function getRepositoriesDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
	const state = getViewDecoration<'repositories'>(uri);

	if (state?.currentWorkspace) {
		return {
			badge: '●',
			color: new ThemeColor('gitlens.decorations.workspaceCurrentForegroundColor' satisfies Colors),
			tooltip: '',
		};
	}

	return undefined;
}

interface RepositoryViewDecoration {
	state?: 'open' | 'missing';
	workspace?: boolean;
}

function getRepositoryDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
	const state = getViewDecoration<'repository'>(uri);
	if (!state?.workspace) return undefined;

	switch (state?.state) {
		case 'open':
			return {
				badge: '●',
				color: new ThemeColor('gitlens.decorations.workspaceRepoOpenForegroundColor' satisfies Colors),
				tooltip: '',
			};
		case 'missing':
			return {
				badge: '?',
				color: new ThemeColor('gitlens.decorations.workspaceRepoMissingForegroundColor' satisfies Colors),
				tooltip: '',
			};
	}

	return undefined;
}

interface WorkspaceViewDecoration {
	current?: boolean;
}

function getWorkspaceDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
	const state = getViewDecoration<'workspace'>(uri);

	if (state?.current) {
		return {
			badge: '●',
			color: new ThemeColor('gitlens.decorations.workspaceCurrentForegroundColor' satisfies Colors),
			tooltip: '',
		};
	}

	return undefined;
}

interface WorktreeViewDecoration {
	hasChanges?: boolean;
	missing?: boolean;
}

function getWorktreeDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
	const state = getViewDecoration<'worktree'>(uri);

	if (state?.missing) {
		return {
			badge: GlyphChars.Warning,
			color: new ThemeColor('gitlens.decorations.worktreeMissingForegroundColor' satisfies Colors),
			tooltip: '',
		};
	}

	if (state?.hasChanges) {
		return {
			badge: '●',
			color: new ThemeColor('gitlens.decorations.worktreeHasUncommittedChangesForegroundColor' as Colors),
			tooltip: 'Has Uncommitted Changes',
		};
	}

	return undefined;
}

type ViewDecorations = {
	branch: BranchViewDecoration;
	'commit-file': CommitFileViewDecoration;
	remote: RemoteViewDecoration;
	repositories: RepositoriesViewDecoration;
	repository: RepositoryViewDecoration;
	status: StatusViewDecoration;
	workspace: WorkspaceViewDecoration;
	worktree: WorktreeViewDecoration;
};

export function createViewDecorationUri<T extends keyof ViewDecorations>(type: T, state: ViewDecorations[T]): Uri {
	const query = new URLSearchParams();
	query.set('state', JSON.stringify(state));

	return Uri.parse(`gitlens-view://${type}?${query.toString()}`);
}

function getViewDecoration<T extends keyof ViewDecorations>(uri: Uri): ViewDecorations[T] | undefined {
	const query = new URLSearchParams(uri.query);
	const state = query.get('state');
	if (state == null) return undefined;

	return JSON.parse(state) as ViewDecorations[T];
}
