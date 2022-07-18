import type { QuickPickItem } from 'vscode';
import { window } from 'vscode';
import * as nls from 'vscode-nls';
import { GitActions } from '../../commands/gitCommands.actions';
import type { OpenChangedFilesCommandArgs } from '../../commands/openChangedFiles';
import { QuickCommandButtons } from '../../commands/quickCommand.buttons';
import { Commands, GlyphChars } from '../../constants';
import { Container } from '../../container';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import type { GitCommit } from '../../git/models/commit';
import type { GitFileChange } from '../../git/models/file';
import { GitFile } from '../../git/models/file';
import type { GitStatusFile } from '../../git/models/status';
import type { Keys } from '../../keyboard';
import { basename } from '../../system/path';
import { pad } from '../../system/string';
import { CommandQuickPickItem } from './common';

const localize = nls.loadMessageBundle();
export class CommitFilesQuickPickItem extends CommandQuickPickItem {
	constructor(
		readonly commit: GitCommit,
		options?: {
			file?: GitFileChange;
			unpublished?: boolean | undefined;
			picked?: boolean;
			hint?: string;
		},
	) {
		super(
			{
				label: commit.summary,
				description: `${CommitFormatter.fromTemplate(`\${author}, \${ago}  $(git-commit)  \${id}`, commit)}${
					options?.unpublished ? `  (${localize('commitFiles.commitUnpublished', 'unpublished')})` : ''
				}`,
				detail: `${
					options?.file != null
						? `$(file) ${basename(options.file.path)}${options.file.formatStats({
								expand: true,
								separator: ', ',
								prefix: ` ${GlyphChars.Dot} `,
						  })}`
						: `$(files) ${commit.formatStats({
								expand: true,
								separator: ', ',
								empty: localize('commitFiles.noFilesChanged', 'No files changed'),
						  })}`
				}${options?.hint != null ? `${pad(GlyphChars.Dash, 4, 2, GlyphChars.Space)}${options.hint}` : ''}`,
				alwaysShow: true,
				picked: options?.picked ?? true,
				buttons: [QuickCommandButtons.ShowDetailsView, QuickCommandButtons.RevealInSideBar],
			},
			undefined,
			undefined,
			{ suppressKeyPress: true },
		);
	}

	get sha(): string {
		return this.commit.sha;
	}
}

export class CommitFileQuickPickItem extends CommandQuickPickItem {
	constructor(readonly commit: GitCommit, readonly file: GitFile, picked?: boolean) {
		super({
			label: `${pad(GitFile.getStatusCodicon(file.status), 0, 2)}${basename(file.path)}`,
			description: GitFile.getFormattedDirectory(file, true),
			picked: picked,
		});

		// TODO@eamodio - add line diff details
		// this.detail = this.commit.getFormattedDiffStatus({ expand: true });
	}

	get sha(): string {
		return this.commit.sha;
	}

	override execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openChanges(this.file, this.commit, options);
		// const fileCommit = await this.commit.getCommitForFile(this.file)!;

		// if (fileCommit.previousSha === undefined) {
		// 	void (await findOrOpenEditor(
		// 		GitUri.toRevisionUri(fileCommit.sha, this.file, fileCommit.repoPath),
		// 		options,
		// 	));

		// 	return;
		// }

		// const commandArgs: DiffWithPreviousCommandArgs = {
		// 	commit: fileCommit,
		// 	showOptions: options,
		// };
		// void (await executeCommand(Commands.DiffWithPrevious, fileCommit.toGitUri(), commandArgs));
	}
}

export class CommitBrowseRepositoryFromHereCommandQuickPickItem extends CommandQuickPickItem {
	constructor(
		private readonly commit: GitCommit,
		private readonly executeOptions?: {
			before?: boolean;
			openInNewWindow: boolean;
		},
		item?: QuickPickItem,
	) {
		super(
			item ??
				`$(folder-opened) ${
					executeOptions?.before
						? executeOptions?.openInNewWindow
							? localize(
									'browseRepositoryFromHere.browseRepositoryFromBeforeHereInNewWindow',
									'Browse Repository from Before Here in New Window',
							  )
							: localize(
									'browseRepositoryFromHere.browseRepositoryFromBeforeHere',
									'Browse Repository from Before Here',
							  )
						: executeOptions?.openInNewWindow
						? localize(
								'browseRepositoryFromHere.browseRepositoryFromHereInNewWindow',
								'Browse Repository from Here in New Window',
						  )
						: localize('browseRepositoryFromHere.browseRepositoryFromHere', 'Browse Repository from Here')
				}`,
		);
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.browseAtRevision(this.commit.getGitUri(), {
			before: this.executeOptions?.before,
			openInNewWindow: this.executeOptions?.openInNewWindow,
		});
	}
}

export class CommitCompareWithHEADCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? `$(compare-changes) ${localize('compareWithHead.label', 'Compare with HEAD')}`);
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return Container.instance.searchAndCompareView.compare(this.commit.repoPath, this.commit.ref, 'HEAD');
	}
}

export class CommitCompareWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? `$(compare-changes) ${localize('compareWithWorking.label', 'Compare with Working Tree')}`);
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return Container.instance.searchAndCompareView.compare(this.commit.repoPath, this.commit.ref, '');
	}
}

export class CommitCopyIdQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? `$(copy) ${localize('copyId.copySha', 'Copy SHA')}`);
	}

	override execute(): Promise<void> {
		return GitActions.Commit.copyIdToClipboard(this.commit);
	}

	override async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		void window.showInformationMessage(
			localize('copyId.commitShaCopiedToClipboard', 'Commit SHA copied to the clipboard'),
		);
	}
}

export class CommitCopyMessageQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? `$(copy) ${localize('copyMessage.label', 'Copy Message')}`);
	}

	override execute(): Promise<void> {
		return GitActions.Commit.copyMessageToClipboard(this.commit);
	}

	override async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		void window.showInformationMessage(
			`${
				this.commit.stashName
					? localize('copyMessage.stashMessageCopiedToClipboard', 'Stash Message copied to the clipboard')
					: localize('copyMessage.commitMessageCopiedToClipboard', 'Commit Message copied to the clipboard')
			}`,
		);
	}
}

export class CommitOpenAllChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? `$(git-compare) ${localize('openAllChanges.label', 'Open All Changes')}`);
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openAllChanges(this.commit, options);
	}
}

export class CommitOpenAllChangesWithDiffToolCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? `$(git-compare) ${localize('openAllChangesWithDiffTool.label', 'Open All Changes (difftool)')}`);
	}

	override execute(): Promise<void> {
		return GitActions.Commit.openAllChangesWithDiffTool(this.commit);
	}
}

export class CommitOpenAllChangesWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(
			item ??
				`$(git-compare) ${localize('openAllChangesWithWorking.label', 'Open All Changes with Working Tree')}`,
		);
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openAllChangesWithWorking(this.commit, options);
	}
}

export class CommitOpenChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? `$(git-compare) ${localize('openChanges.label', 'Open Changes')}`);
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openChanges(this.file, this.commit, options);
	}
}

export class CommitOpenChangesWithDiffToolCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? `$(git-compare) ${localize('openChangesWithDiffTool.label', 'Open Changes (difftool)')}`);
	}

	override execute(): Promise<void> {
		return GitActions.Commit.openChangesWithDiffTool(this.file, this.commit);
	}
}

export class CommitOpenChangesWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? `$(git-compare) ${localize('openChangesWithWorking', 'Open Changes with Working File')}`);
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openChangesWithWorking(this.file, this.commit, options);
	}
}

export class CommitOpenDirectoryCompareCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? `$(git-compare) ${localize('openDirectoryCompare.label', 'Open Directory Compare')}`);
	}

	override execute(): Promise<void> {
		return GitActions.Commit.openDirectoryCompareWithPrevious(this.commit);
	}
}

export class CommitOpenDirectoryCompareWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(
			item ??
				`$(git-compare) ${localize(
					'openDirectoryCompareWithWorking.label',
					'Open Directory Compare with Working Tree',
				)}`,
		);
	}

	override execute(): Promise<void> {
		return GitActions.Commit.openDirectoryCompareWithWorking(this.commit);
	}
}

export class CommitOpenDetailsCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(eye) Open Details');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.showDetailsView(this.commit, { preserveFocus: options?.preserveFocus });
	}
}

export class CommitOpenInGraphCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(gitlens-graph) Open in Commit Graph');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.showInCommitGraph(this.commit, { preserveFocus: options?.preserveFocus });
	}
}

export class CommitOpenFilesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? `$(files) ${localize('openFiles.label', 'Open Files')}`);
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFiles(this.commit);
	}
}

export class CommitOpenFileCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? `$(file) ${localize('openFile.label', 'Open File')}`);
	}

	override execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFile(this.file, this.commit, options);
	}
}

export class CommitOpenRevisionsCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? `$(files) ${localize('openRevisions.label', 'Open Files at Revision')}`);
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFilesAtRevision(this.commit);
	}
}

export class CommitOpenRevisionCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? `$(file) ${localize('openRevision.label', 'Open File at Revision')}`);
	}

	override execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFileAtRevision(this.file, this.commit, options);
	}
}

export class CommitApplyFileChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? localize('applyFileChanges.label', 'Apply Changes'));
	}

	override async execute(): Promise<void> {
		return GitActions.Commit.applyChanges(this.file, this.commit);
	}
}

export class CommitRestoreFileChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(
			item ?? {
				label: localize('restoreFileChanges.label', 'Restore'),
				description: localize('restoreFileChanges.description', 'aka checkout'),
			},
		);
	}

	override execute(): Promise<void> {
		return GitActions.Commit.restoreFile(this.file, this.commit);
	}
}

export class OpenChangedFilesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(files: GitStatusFile[], item?: QuickPickItem) {
		const commandArgs: OpenChangedFilesCommandArgs = {
			uris: files.map(f => f.uri),
		};

		super(
			item ?? `$(files) ${localize('openChangedFiles.label', 'Open All Changed Files')}`,
			Commands.OpenChangedFiles,
			[commandArgs],
		);
	}
}
