'use strict';
import * as paths from 'path';
import { commands, QuickPickItem, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import {
	Commands,
	CopyMessageToClipboardCommandArgs,
	CopyRemoteFileUrlToClipboardCommandArgs,
	CopyShaToClipboardCommandArgs,
	DiffDirectoryCommandArgs,
	DiffWithPreviousCommandArgs,
	findOrOpenEditor,
	OpenWorkingFileCommandArgs,
	ShowQuickCommitDetailsCommandArgs,
	StashApplyCommandArgs,
	StashDeleteCommandArgs,
} from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
	GitFile,
	GitLog,
	GitLogCommit,
	GitService,
	GitStashCommit,
	GitUri,
	RemoteResourceType,
} from '../git/gitService';
import { KeyNoopCommand, Keys } from '../keyboard';
import { Arrays, Iterables, Strings } from '../system';
import {
	CommandQuickPickItem,
	getQuickPickIgnoreFocusOut,
	KeyCommandQuickPickItem,
	OpenInSearchCommitsViewQuickPickItem,
	RevealInRepositoriesViewQuickPickItem,
} from './commonQuickPicks';
import { OpenRemotesCommandQuickPickItem } from './remotesQuickPick';

export class CommitWithFileStatusQuickPickItem extends CommandQuickPickItem {
	constructor(public readonly commit: GitLogCommit, private readonly _file: GitFile) {
		super({
			label: `${Strings.pad(GitFile.getStatusOcticon(_file.status), 4, 2)} ${paths.basename(_file.fileName)}`,
			description: GitFile.getFormattedDirectory(_file, true),
		});

		this.commit = commit.toFileCommit(_file);
	}

	get sha(): string {
		return this.commit.sha;
	}

	execute(options?: TextDocumentShowOptions): Thenable<TextEditor | undefined> {
		return findOrOpenEditor(GitUri.toRevisionUri(this.commit.sha, this._file, this.commit.repoPath), options);
	}

	async onDidPressKey(key: Keys): Promise<void> {
		if (this.commit.previousSha === undefined) {
			await super.onDidPressKey(key);
		}

		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			showOptions: {
				preserveFocus: true,
				preview: false,
			},
		};
		await commands.executeCommand(Commands.DiffWithPrevious, this.commit.toGitUri(), commandArgs);
	}
}

export class OpenCommitFilesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly _commit: GitLogCommit, item?: QuickPickItem) {
		super(
			item || {
				label: '$(file-symlink-file) Open Files',
				description: '',
				// detail: `Opens all of the changed file in the working tree`
			},
		);
	}

	async execute(
		options: TextDocumentShowOptions = { preserveFocus: false, preview: false },
	): Promise<{} | undefined> {
		const uris = Arrays.filterMap(this._commit.files, f =>
			GitUri.fromFile(f, this._commit.repoPath, this._commit.sha),
		);
		for (const uri of uris) {
			const args: OpenWorkingFileCommandArgs = {
				uri: uri,
				showOptions: options,
			};
			await commands.executeCommand(Commands.OpenWorkingFile, undefined, args);
		}

		return undefined;
	}

	async onDidPressKey(key: Keys): Promise<void> {
		await this.execute({
			preserveFocus: true,
			preview: false,
		});
	}
}

export class OpenCommitFileRevisionsCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly _commit: GitLogCommit, item?: QuickPickItem) {
		super(
			item || {
				label: '$(file-symlink-file) Open Revisions',
				description: `from ${GlyphChars.Space}$(git-commit) ${_commit.shortSha}`,
				// detail: `Opens all of the changed files in $(git-commit) ${commit.shortSha}`
			},
		);
	}

	async execute(
		options: TextDocumentShowOptions = { preserveFocus: false, preview: false },
	): Promise<{} | undefined> {
		const uris = Arrays.filterMap(this._commit.files, f =>
			GitUri.toRevisionUri(
				f.status === 'D' ? this._commit.previousFileSha : this._commit.sha,
				f,
				this._commit.repoPath,
			),
		);

		for (const uri of uris) {
			await findOrOpenEditor(uri, options);
		}
		return undefined;
	}

	async onDidPressKey(key: Keys): Promise<void> {
		await this.execute({
			preserveFocus: true,
			preview: false,
		});
	}
}

export interface CommitQuickPickOptions {
	currentCommand?: CommandQuickPickItem;
	goBackCommand?: CommandQuickPickItem;
	repoLog?: GitLog;
	showChanges?: boolean;
}

export class CommitQuickPick {
	constructor(public readonly repoPath: string | undefined) {}

	async show(
		commit: GitLogCommit,
		uri: Uri,
		options: CommitQuickPickOptions = {},
	): Promise<CommitWithFileStatusQuickPickItem | CommandQuickPickItem | undefined> {
		options = { showChanges: true, ...options };

		let previousCommand: (() => Promise<KeyCommandQuickPickItem | typeof KeyNoopCommand>) | undefined = undefined;
		let nextCommand: (() => Promise<KeyCommandQuickPickItem | typeof KeyNoopCommand>) | undefined = undefined;
		if (!commit.isStash) {
			previousCommand = async () => {
				const previousRef =
					commit.previousSha === undefined || GitService.isShaParent(commit.previousSha)
						? await Container.git.resolveReference(commit.repoPath, commit.previousSha || commit.sha)
						: commit.previousSha;
				if (previousRef === undefined) return KeyNoopCommand;

				const previousCommandArgs: ShowQuickCommitDetailsCommandArgs = {
					repoLog: options.repoLog,
					sha: previousRef,
					goBackCommand: options.goBackCommand,
				};
				return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
					Uri.file(commit.repoPath),
					previousCommandArgs,
				]);
			};

			nextCommand = async () => {
				let log = options.repoLog;
				let c = log && log.commits.get(commit.sha);

				// If we can't find the commit or the next commit isn't available (since it isn't trustworthy)
				if (c === undefined || c.nextSha === undefined) {
					log = undefined;
					c = undefined;

					// Try to find the next commit
					const nextLog = await Container.git.getLog(commit.repoPath, {
						limit: 1,
						reverse: true,
						ref: commit.sha,
					});

					const next = nextLog && Iterables.first(nextLog.commits.values());
					if (next !== undefined && next.sha !== commit.sha) {
						c = commit;
						c.nextSha = next.sha;
					}
				}

				if (c === undefined || c.nextSha === undefined) return KeyNoopCommand;

				const nextCommandArgs: ShowQuickCommitDetailsCommandArgs = {
					repoLog: log,
					sha: c.nextSha,
					goBackCommand: options.goBackCommand,
				};
				return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
					Uri.file(commit.repoPath),
					nextCommandArgs,
				]);
			};
		}

		const scope = await Container.keyboard.beginScope({
			'alt+left': options.goBackCommand,
			'alt+,': previousCommand,
			'alt+.': nextCommand,
		});

		const pick = await window.showQuickPick(CommitQuickPick.getItems(commit, uri, options), {
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: `${commit.shortSha} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${
				commit.author ? `${commit.author}, ` : ''
			}${commit.formattedDate} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.getShortMessage()}`,
			ignoreFocusOut: getQuickPickIgnoreFocusOut(),
			onDidSelectItem: (item: QuickPickItem) => {
				void scope.setKeyCommand('alt+right', item);
				if (typeof item.onDidSelect === 'function') {
					item.onDidSelect();
				}
			},
		});

		await scope.dispose();

		return pick;
	}

	static async getItems(commit: GitLogCommit, uri: Uri, options: CommitQuickPickOptions = {}) {
		const items: CommandQuickPickItem[] = [];

		let remotes;
		if (GitStashCommit.is(commit)) {
			const stashApplyCommmandArgs: StashApplyCommandArgs = {
				deleteAfter: false,
				stashItem: commit,
				goBackCommand: options.currentCommand,
			};
			items.push(
				new CommandQuickPickItem(
					{
						label: '$(git-pull-request) Apply Stash',
						description: `${
							commit.number === undefined ? '' : `${commit.number}: `
						}${commit.getShortMessage()}`,
					},
					Commands.StashApply,
					[stashApplyCommmandArgs],
				),
			);

			const stashDeleteCommmandArgs: StashDeleteCommandArgs = {
				stashItem: commit,
				goBackCommand: options.currentCommand,
			};
			items.push(
				new CommandQuickPickItem(
					{
						label: '$(x) Delete Stash',
						description: `${
							commit.number === undefined ? '' : `${commit.number}: `
						}${commit.getShortMessage()}`,
					},
					Commands.StashDelete,
					[stashDeleteCommmandArgs],
				),
			);

			items.push(new RevealInRepositoriesViewQuickPickItem(commit));
		} else {
			items.push(new OpenInSearchCommitsViewQuickPickItem(commit));
			items.push(new RevealInRepositoriesViewQuickPickItem(commit));
			items.push(new OpenCommitFilesCommandQuickPickItem(commit));
			items.push(new OpenCommitFileRevisionsCommandQuickPickItem(commit));

			remotes = await Container.git.getRemotes(commit.repoPath, { sort: true });
			if (remotes.length) {
				items.push(
					new OpenRemotesCommandQuickPickItem(
						remotes,
						{
							type: RemoteResourceType.Commit,
							sha: commit.sha,
						},
						options.currentCommand,
					),
				);
			}
		}

		const previousSha = await Container.git.resolveReference(commit.repoPath, commit.previousFileSha);

		let diffDirectoryCommmandArgs: DiffDirectoryCommandArgs = {
			ref1: previousSha,
			ref2: commit.sha,
		};
		items.push(
			new CommandQuickPickItem(
				{
					label: '$(git-compare) Open Directory Compare with Previous Revision',
					description: `$(git-commit) ${GitService.shortenSha(previousSha)} ${
						GlyphChars.Space
					} $(git-compare) ${GlyphChars.Space} $(git-commit) ${commit.shortSha}`,
				},
				Commands.DiffDirectory,
				[commit.uri, diffDirectoryCommmandArgs],
			),
		);

		diffDirectoryCommmandArgs = {
			ref1: commit.sha,
		};
		items.push(
			new CommandQuickPickItem(
				{
					label: '$(git-compare) Open Directory Compare with Working Tree',
					description: `$(git-commit) ${commit.shortSha} ${GlyphChars.Space} $(git-compare) ${GlyphChars.Space} Working Tree`,
				},
				Commands.DiffDirectory,
				[uri, diffDirectoryCommmandArgs],
			),
		);

		if (!GitStashCommit.is(commit)) {
			const copyShaCommandArgs: CopyShaToClipboardCommandArgs = {
				sha: commit.sha,
			};
			items.push(
				new CommandQuickPickItem(
					{
						label: '$(clippy) Copy Commit ID to Clipboard',
						description: '',
					},
					Commands.CopyShaToClipboard,
					[uri, copyShaCommandArgs],
				),
			);
		}

		const copyMessageCommandArgs: CopyMessageToClipboardCommandArgs = {
			message: commit.message,
			sha: commit.sha,
		};
		items.push(
			new CommandQuickPickItem(
				{
					label: `$(clippy) Copy ${commit.isStash ? 'Stash' : 'Commit'} Message to Clipboard`,
					description: '',
				},
				Commands.CopyMessageToClipboard,
				[uri, copyMessageCommandArgs],
			),
		);

		if (!GitStashCommit.is(commit)) {
			if (remotes !== undefined && remotes.length) {
				const copyRemoteUrlCommandArgs: CopyRemoteFileUrlToClipboardCommandArgs = {
					sha: commit.sha,
				};
				items.push(
					new CommandQuickPickItem(
						{
							label: '$(clippy) Copy Remote Url to Clipboard',
						},
						Commands.CopyRemoteFileUrlToClipboard,
						[uri, copyRemoteUrlCommandArgs],
					),
				);
			}
		}

		if (options.showChanges) {
			const commitDetailsCommandArgs: ShowQuickCommitDetailsCommandArgs = {
				commit: commit,
				repoLog: options.repoLog,
				sha: commit.sha,
				goBackCommand: options.goBackCommand,
			};
			items.push(
				new CommandQuickPickItem(
					{
						label: 'Changed Files',
						description: commit.getFormattedDiffStatus(),
					},
					Commands.ShowQuickCommitDetails,
					[uri, commitDetailsCommandArgs],
				),
			);

			items.push(...commit.files.map(fs => new CommitWithFileStatusQuickPickItem(commit, fs)));
		}

		if (options.goBackCommand) {
			items.splice(0, 0, options.goBackCommand);
		}

		return items;
	}
}
