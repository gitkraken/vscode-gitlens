import type { CancellationToken, Event, FileDecoration, FileDecorationProvider, Uri } from 'vscode';
import { Disposable, EventEmitter, ThemeColor, window } from 'vscode';
import * as nls from 'vscode-nls';
import { GlyphChars } from '../constants';
import { GitBranchStatus } from '../git/models/branch';

const localize = nls.loadMessageBundle();

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

					return undefined;
				},
			}),
			window.registerFileDecorationProvider(this),
		);
	}

	dispose(): void {
		this.disposable.dispose();
	}

	provideFileDecoration(uri: Uri, token: CancellationToken): FileDecoration | undefined {
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
					color: new ThemeColor('gitlens.decorations.ignoredForegroundColor'),
					tooltip: localize('commitFile.status.ignored', 'Ignored'),
				};
			case '?':
				return {
					badge: 'U',
					color: new ThemeColor('gitlens.decorations.untrackedForegroundColor'),
					tooltip: localize('commitFile.status.untracked', 'Untracked'),
				};
			case 'A':
				return {
					badge: 'A',
					color: new ThemeColor('gitlens.decorations.addedForegroundColor'),
					tooltip: localize('gitlens.viewDecorationProvider.commitFileStatusAdded', 'Added'),
				};
			case 'C':
				return {
					badge: 'C',
					color: new ThemeColor('gitlens.decorations.copiedForegroundColor'),
					tooltip: localize('commitFile.status.copied', 'Copied'),
				};
			case 'D':
				return {
					badge: 'D',
					color: new ThemeColor('gitlens.decorations.deletedForegroundColor'),
					tooltip: localize('commitFile.status.deleted', 'Deleted'),
				};
			case 'M':
				return {
					badge: 'M',
					// color: new ThemeColor('gitlens.decorations.modifiedForegroundColor'),
					tooltip: localize('commitFile.status.modified', 'Modified'),
				};
			case 'R':
				return {
					badge: 'R',
					color: new ThemeColor('gitlens.decorations.renamedForegroundColor'),
					tooltip: localize('commitFile.status.renamed', 'Renamed'),
				};
			default:
				return undefined;
		}
	}

	provideBranchStatusDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
		const [, , status] = uri.path.split('/');

		switch (status as GitBranchStatus) {
			case GitBranchStatus.Ahead:
				return {
					badge: '▲',
					color: new ThemeColor('gitlens.decorations.branchAheadForegroundColor'),
					tooltip: localize('branch.status.ahead', 'Ahead'),
				};
			case GitBranchStatus.Behind:
				return {
					badge: '▼',
					color: new ThemeColor('gitlens.decorations.branchBehindForegroundColor'),
					tooltip: localize('branch.status.behind', 'Behind'),
				};
			case GitBranchStatus.Diverged:
				return {
					badge: '▼▲',
					color: new ThemeColor('gitlens.decorations.branchDivergedForegroundColor'),
					tooltip: localize('branch.status.diverged', 'Diverged'),
				};
			case GitBranchStatus.MissingUpstream:
				return {
					badge: '!',
					color: new ThemeColor('gitlens.decorations.branchMissingUpstreamForegroundColor'),
					tooltip: localize('branch.status.missingUpstream', 'Missing Upstream'),
				};
			case GitBranchStatus.UpToDate:
				return {
					badge: '',
					color: new ThemeColor('gitlens.decorations.branchUpToDateForegroundColor'),
					tooltip: localize('branch.status.upToDate', 'Up to Date'),
				};
			case GitBranchStatus.Unpublished:
				return {
					badge: '▲+',
					color: new ThemeColor('gitlens.decorations.branchUnpublishedForegroundColor'),
					tooltip: localize('branch.status.unpublished', 'Unpublished'),
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
			case GitBranchStatus.Ahead:
				color = new ThemeColor('gitlens.decorations.branchAheadForegroundColor');
				break;
			case GitBranchStatus.Behind:
				color = new ThemeColor('gitlens.decorations.branchBehindForegroundColor');
				break;
			case GitBranchStatus.Diverged:
				color = new ThemeColor('gitlens.decorations.branchDivergedForegroundColor');
				break;
			case GitBranchStatus.UpToDate:
				color = new ThemeColor('gitlens.decorations.branchUpToDateForegroundColor');
				break;
			case GitBranchStatus.Unpublished:
				color = new ThemeColor('gitlens.decorations.branchUnpublishedForegroundColor');
				break;
		}

		return {
			badge: GlyphChars.Check,
			color: color,
			tooltip: localize('currentBranch', 'Current Branch'),
		};
	}

	provideRemoteDefaultDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
		const [, isDefault] = uri.path.split('/');

		if (!isDefault) return undefined;

		return {
			badge: GlyphChars.Check,
			tooltip: localize('defaultRemote', 'Default Remote'),
		};
	}
}
