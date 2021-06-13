'use strict';
import * as paths from 'path';
import { QuickPickItem, window } from 'vscode';
import { Commands, GitActions, OpenChangedFilesCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { CommitFormatter, GitFile, GitLogCommit, GitStatusFile } from '../git/git';
import { Keys } from '../keyboard';
import { Strings } from '../system';
import { CommandQuickPickItem } from './quickPicksItems';

export class CommitFilesQuickPickItem extends CommandQuickPickItem {
	constructor(readonly commit: GitLogCommit, picked: boolean = true, fileName?: string) {
		super(
			{
				label: commit.getShortMessage(),
				description: CommitFormatter.fromTemplate(`\${author}, \${ago}  $(git-commit)  \${id}`, commit),
				detail: `$(files) ${commit.getFormattedDiffStatus({
					expand: true,
					separator: ', ',
					empty: 'No files changed',
				})}${fileName ? `${Strings.pad(GlyphChars.Dot, 2, 2)}${fileName}` : ''}`,
				picked: picked,
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
	constructor(readonly commit: GitLogCommit, readonly file: GitFile, picked?: boolean) {
		super({
			label: `${Strings.pad(GitFile.getStatusCodicon(file.status), 0, 2)}${paths.basename(file.fileName)}`,
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
		// const fileCommit = this.commit.toFileCommit(this.file)!;

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
		// void (await commands.executeCommand(Commands.DiffWithPrevious, fileCommit.toGitUri(), commandArgs));
	}
}

export class CommitBrowseRepositoryFromHereCommandQuickPickItem extends CommandQuickPickItem {
	constructor(
		private readonly commit: GitLogCommit,
		private readonly executeOptions?: {
			before?: boolean;
			openInNewWindow: boolean;
		},
		item?: QuickPickItem,
	) {
		super(
			item ??
				`$(folder-opened) Browse Repository from${executeOptions?.before ? ' Before' : ''} Here${
					executeOptions?.openInNewWindow ? ' in New Window' : ''
				}`,
		);
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.browseAtRevision(this.commit.toGitUri(), {
			before: this.executeOptions?.before,
			openInNewWindow: this.executeOptions?.openInNewWindow,
		});
	}
}

export class CommitCompareWithHEADCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(compare-changes) Compare with HEAD');
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return Container.searchAndCompareView.compare(this.commit.repoPath, this.commit.ref, 'HEAD');
	}
}

export class CommitCompareWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(compare-changes) Compare with Working Tree');
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return Container.searchAndCompareView.compare(this.commit.repoPath, this.commit.ref, '');
	}
}

export class CommitCopyIdQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(clippy) Copy SHA');
	}

	override execute(): Promise<void> {
		return GitActions.Commit.copyIdToClipboard(this.commit);
	}

	override async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		void window.showInformationMessage('Commit SHA copied to the clipboard');
	}
}

export class CommitCopyMessageQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(clippy) Copy Message');
	}

	override execute(): Promise<void> {
		return GitActions.Commit.copyMessageToClipboard(this.commit);
	}

	override async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		void window.showInformationMessage(
			`${this.commit.isStash ? 'Stash' : 'Commit'} Message copied to the clipboard`,
		);
	}
}

export class CommitOpenAllChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open All Changes');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openAllChanges(this.commit, options);
	}
}

export class CommitOpenAllChangesWithDiffToolCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open All Changes (difftool)');
	}

	override execute(): Promise<void> {
		return GitActions.Commit.openAllChangesWithDiffTool(this.commit);
	}
}

export class CommitOpenAllChangesWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open All Changes with Working Tree');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openAllChangesWithWorking(this.commit, options);
	}
}

export class CommitOpenChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Changes');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openChanges(this.file, this.commit, options);
	}
}

export class CommitOpenChangesWithDiffToolCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Changes (difftool)');
	}

	override execute(): Promise<void> {
		return GitActions.Commit.openChangesWithDiffTool(this.file, this.commit);
	}
}

export class CommitOpenChangesWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Changes with Working File');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openChangesWithWorking(this.file, this.commit, options);
	}
}

export class CommitOpenDirectoryCompareCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Directory Compare');
	}

	override execute(): Promise<void> {
		return GitActions.Commit.openDirectoryCompareWithPrevious(this.commit);
	}
}

export class CommitOpenDirectoryCompareWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Directory Compare with Working Tree');
	}

	override execute(): Promise<void> {
		return GitActions.Commit.openDirectoryCompareWithWorking(this.commit);
	}
}

export class CommitOpenFilesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(files) Open Files');
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFiles(this.commit);
	}
}

export class CommitOpenFileCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(file) Open File');
	}

	override execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFile(this.file, this.commit, options);
	}
}

export class CommitOpenRevisionsCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(files) Open Files at Revision');
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFilesAtRevision(this.commit);
	}
}

export class CommitOpenRevisionCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(file) Open File at Revision');
	}

	override execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFileAtRevision(this.file, this.commit, options);
	}
}

export class CommitApplyFileChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? 'Apply Changes');
	}

	override async execute(): Promise<void> {
		return GitActions.Commit.applyChanges(this.file, this.commit);
	}
}

export class CommitRestoreFileChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(
			item ?? {
				label: 'Restore',
				description: 'aka checkout',
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

		super(item ?? '$(files) Open All Changed Files', Commands.OpenChangedFiles, [commandArgs]);
	}
}
