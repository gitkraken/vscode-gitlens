import type { QuickPickItem } from 'vscode';
import { window } from 'vscode';
import type { OpenChangedFilesCommandArgs } from '../../commands/openChangedFiles';
import { RevealInSideBarQuickInputButton, ShowDetailsViewQuickInputButton } from '../../commands/quickCommand.buttons';
import { Commands, GlyphChars } from '../../constants';
import { Container } from '../../container';
import { browseAtRevision } from '../../git/actions';
import * as CommitActions from '../../git/actions/commit';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import type { GitCommit } from '../../git/models/commit';
import type { GitFile, GitFileChange } from '../../git/models/file';
import { getGitFileFormattedDirectory, getGitFileStatusCodicon } from '../../git/models/file';
import type { GitStatusFile } from '../../git/models/status';
import type { Keys } from '../../system/keyboard';
import { basename } from '../../system/path';
import { pad } from '../../system/string';
import { CommandQuickPickItem } from './common';

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
					options?.unpublished ? '  (unpublished)' : ''
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
								empty: 'No files changed',
						  })}`
				}${options?.hint != null ? `${pad(GlyphChars.Dash, 4, 2, GlyphChars.Space)}${options.hint}` : ''}`,
				alwaysShow: true,
				picked: options?.picked ?? true,
				buttons: [ShowDetailsViewQuickInputButton, RevealInSideBarQuickInputButton],
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
			label: `${pad(getGitFileStatusCodicon(file.status), 0, 2)}${basename(file.path)}`,
			description: getGitFileFormattedDirectory(file, true),
			picked: picked,
		});

		// TODO@eamodio - add line diff details
		// this.detail = this.commit.getFormattedDiffStatus({ expand: true });
	}

	get sha(): string {
		return this.commit.sha;
	}

	override execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.openChanges(this.file, this.commit, options);
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
				`$(folder-opened) Browse Repository from${executeOptions?.before ? ' Before' : ''} Here${
					executeOptions?.openInNewWindow ? ' in New Window' : ''
				}`,
		);
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return browseAtRevision(this.commit.getGitUri(), {
			before: this.executeOptions?.before,
			openInNewWindow: this.executeOptions?.openInNewWindow,
		});
	}
}

export class CommitCompareWithHEADCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(compare-changes) Compare with HEAD');
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return Container.instance.searchAndCompareView.compare(this.commit.repoPath, this.commit.ref, 'HEAD');
	}
}

export class CommitCompareWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(compare-changes) Compare with Working Tree');
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return Container.instance.searchAndCompareView.compare(this.commit.repoPath, this.commit.ref, '');
	}
}

export class CommitCopyIdQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(copy) Copy SHA');
	}

	override execute(): Promise<void> {
		return CommitActions.copyIdToClipboard(this.commit);
	}

	override async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		void window.showInformationMessage('Commit SHA copied to the clipboard');
	}
}

export class CommitCopyMessageQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(copy) Copy Message');
	}

	override execute(): Promise<void> {
		return CommitActions.copyMessageToClipboard(this.commit);
	}

	override async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		void window.showInformationMessage(
			`${this.commit.stashName ? 'Stash' : 'Commit'} Message copied to the clipboard`,
		);
	}
}

export class CommitOpenAllChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open All Changes');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.openAllChanges(this.commit, options);
	}
}

export class CommitOpenAllChangesWithDiffToolCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open All Changes (difftool)');
	}

	override execute(): Promise<void> {
		return CommitActions.openAllChangesWithDiffTool(this.commit);
	}
}

export class CommitOpenAllChangesWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open All Changes with Working Tree');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.openAllChangesWithWorking(this.commit, options);
	}
}

export class CommitOpenChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Changes');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.openChanges(this.file, this.commit, options);
	}
}

export class CommitOpenChangesWithDiffToolCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Changes (difftool)');
	}

	override execute(): Promise<void> {
		return CommitActions.openChangesWithDiffTool(this.file, this.commit);
	}
}

export class CommitOpenChangesWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Changes with Working File');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.openChangesWithWorking(this.file, this.commit, options);
	}
}

export class CommitOpenDirectoryCompareCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Directory Compare');
	}

	override execute(): Promise<void> {
		return CommitActions.openDirectoryCompareWithPrevious(this.commit);
	}
}

export class CommitOpenDirectoryCompareWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Directory Compare with Working Tree');
	}

	override execute(): Promise<void> {
		return CommitActions.openDirectoryCompareWithWorking(this.commit);
	}
}

export class CommitOpenDetailsCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(eye) Open Details');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.showDetailsView(this.commit, { preserveFocus: options?.preserveFocus });
	}
}

export class CommitOpenInGraphCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(gitlens-graph) Open in Commit Graph');
	}

	override execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.showInCommitGraph(this.commit, { preserveFocus: options?.preserveFocus });
	}
}

export class CommitOpenFilesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(files) Open Files');
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.openFiles(this.commit);
	}
}

export class CommitOpenFileCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(file) Open File');
	}

	override execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.openFile(this.file, this.commit, options);
	}
}

export class CommitOpenRevisionsCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, item?: QuickPickItem) {
		super(item ?? '$(files) Open Files at Revision');
	}

	override execute(_options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.openFilesAtRevision(this.commit);
	}
}

export class CommitOpenRevisionCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(file) Open File at Revision');
	}

	override execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return CommitActions.openFileAtRevision(this.file, this.commit, options);
	}
}

export class CommitApplyFileChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? 'Apply Changes');
	}

	override async execute(): Promise<void> {
		return CommitActions.applyChanges(this.file, this.commit);
	}
}

export class CommitRestoreFileChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(
			item ?? {
				label: 'Restore',
				description: 'aka checkout',
			},
		);
	}

	override execute(): Promise<void> {
		return CommitActions.restoreFile(this.file, this.commit);
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
