'use strict';
import {
	CancellationToken,
	Disposable,
	Event,
	EventEmitter,
	FileDecoration,
	FileDecorationProvider,
	ThemeColor,
	Uri,
	window,
} from 'vscode';
import { GlyphChars } from '../constants';
import { GitBranchStatus } from '../git/git';

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
					if (uri.scheme !== 'gitlens-view' || uri.authority !== 'branch') return undefined;

					return this.provideBranchCurrentDecoration(uri, token);
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
					tooltip: 'Ignored',
				};
			case '?':
				return {
					badge: 'U',
					color: new ThemeColor('gitlens.decorations.untrackedForegroundColor'),
					tooltip: 'Untracked',
				};
			case 'A':
				return {
					badge: 'A',
					color: new ThemeColor('gitlens.decorations.addedForegroundColor'),
					tooltip: 'Added',
				};
			case 'C':
				return {
					badge: 'C',
					color: new ThemeColor('gitlens.decorations.copiedForegroundColor'),
					tooltip: 'Copied',
				};
			case 'D':
				return {
					badge: 'D',
					color: new ThemeColor('gitlens.decorations.deletedForegroundColor'),
					tooltip: 'Deleted',
				};
			case 'M':
				return {
					badge: 'M',
					// color: new ThemeColor('gitlens.decorations.modifiedForegroundColor'),
					tooltip: 'Modified',
				};
			case 'R':
				return {
					badge: 'R',
					color: new ThemeColor('gitlens.decorations.renamedForegroundColor'),
					tooltip: 'Renamed',
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
					badge: '⮝',
					color: new ThemeColor('gitlens.decorations.branchAheadForegroundColor'),
					tooltip: 'Ahead',
				};
			case GitBranchStatus.Behind:
				return {
					badge: '⮟',
					color: new ThemeColor('gitlens.decorations.branchBehindForegroundColor'),
					tooltip: 'Behind',
				};
			case GitBranchStatus.Diverged:
				return {
					badge: '⮟⮝',
					color: new ThemeColor('gitlens.decorations.branchDivergedForegroundColor'),
					tooltip: 'Diverged',
				};
			case GitBranchStatus.UpToDate:
				return {
					badge: '',
					color: new ThemeColor('gitlens.decorations.branchUpToDateForegroundColor'),
					tooltip: 'Up to Date',
				};
			case GitBranchStatus.Unpublished:
				return {
					badge: '⮙+',
					color: new ThemeColor('gitlens.decorations.branchUnpublishedForegroundColor'),
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
			tooltip: 'Current Branch',
		};
	}
}
