'use strict';
import * as paths from 'path';
import { commands, TextDocumentShowOptions, TextEditor, window } from 'vscode';
import {
	Commands,
	DiffWithPreviousCommandArgs,
	OpenChangedFilesCommandArgs,
	openEditor,
	ShowQuickBranchHistoryCommandArgs,
	ShowQuickRepoStatusCommandArgs,
	ShowQuickStashListCommandArgs
} from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
	GitCommitType,
	GitFileStatus,
	GitLogCommit,
	GitService,
	GitStatus,
	GitStatusFile,
	GitUri
} from '../git/gitService';
import { Keys } from '../keyboard';
import { Iterables, Strings } from '../system';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, QuickPickItem } from './commonQuickPicks';

export class OpenStatusFileCommandQuickPickItem extends CommandQuickPickItem {
	readonly status: GitStatusFile;
	private readonly commit: GitLogCommit;

	constructor(private readonly _status: GitStatusFile, realIndexStatus?: GitFileStatus, item?: QuickPickItem) {
		super(
			item || {
				label: `${_status.staged ? '$(check)' : GlyphChars.Space.repeat(3)}${Strings.pad(
					_status.getOcticon(),
					2,
					2
				)} ${paths.basename(_status.fileName)}`,
				description: _status.getFormattedDirectory(true)
			}
		);

		this.status = _status;
		if (_status.indexStatus !== undefined) {
			this.commit = new GitLogCommit(
				GitCommitType.LogFile,
				_status.repoPath,
				GitService.uncommittedStagedSha,
				'You',
				undefined,
				new Date(),
				new Date(),
				'',
				_status.fileName,
				[_status],
				_status.status,
				_status.originalFileName,
				'HEAD',
				_status.fileName
			);
		} else {
			this.commit = new GitLogCommit(
				GitCommitType.LogFile,
				_status.repoPath,
				GitService.uncommittedSha,
				'You',
				undefined,
				new Date(),
				new Date(),
				'',
				_status.fileName,
				[_status],
				_status.status,
				_status.originalFileName,
				realIndexStatus !== undefined ? GitService.uncommittedStagedSha : 'HEAD',
				_status.fileName
			);
		}
	}

	execute(options?: TextDocumentShowOptions): Thenable<TextEditor | undefined> {
		return openEditor(this._status.uri, options);
	}

	onDidPressKey(key: Keys): Promise<{} | undefined> {
		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: false
			}
		};
		return commands.executeCommand(
			Commands.DiffWithPrevious,
			GitUri.fromFile(this.status, this.status.repoPath),
			commandArgs
		) as Promise<{} | undefined>;
	}
}

export class OpenStatusFilesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(files: GitStatusFile[], item?: QuickPickItem) {
		const uris = files.map(f => f.uri);
		const commandArgs: OpenChangedFilesCommandArgs = {
			uris: uris
		};

		super(
			item || {
				label: '$(file-symlink-file) Open Changed Files',
				description: ''
				// detail: `Opens all of the changed files in the repository`
			},
			Commands.OpenChangedFiles,
			[undefined, commandArgs]
		);
	}
}

interface ComputedStatus {
	staged: number;
	stagedAddsAndChanges: GitStatusFile[];
	stagedStatus: string;

	unstaged: number;
	unstagedAddsAndChanges: GitStatusFile[];
	unstagedStatus: string;
}

export class RepoStatusQuickPick {
	private static computeStatus(files: GitStatusFile[]): ComputedStatus {
		let stagedAdds = 0;
		let unstagedAdds = 0;
		let stagedChanges = 0;
		let unstagedChanges = 0;
		let stagedDeletes = 0;
		let unstagedDeletes = 0;

		const stagedAddsAndChanges: GitStatusFile[] = [];
		const unstagedAddsAndChanges: GitStatusFile[] = [];

		for (const f of files) {
			switch (f.indexStatus) {
				case 'A':
				case '?':
					stagedAdds++;
					stagedAddsAndChanges.push(f);
					break;

				case 'D':
					stagedDeletes++;
					break;

				case undefined:
					break;

				default:
					stagedChanges++;
					stagedAddsAndChanges.push(f);
					break;
			}

			switch (f.workingTreeStatus) {
				case 'A':
				case '?':
					unstagedAdds++;
					unstagedAddsAndChanges.push(f);
					break;

				case 'D':
					unstagedDeletes++;
					break;

				case undefined:
					break;

				default:
					unstagedChanges++;
					unstagedAddsAndChanges.push(f);
					break;
			}
		}

		const staged = stagedAdds + stagedChanges + stagedDeletes;
		const unstaged = unstagedAdds + unstagedChanges + unstagedDeletes;

		return {
			staged: staged,
			stagedStatus: staged > 0 ? `+${stagedAdds} ~${stagedChanges} -${stagedDeletes}` : '',
			stagedAddsAndChanges: stagedAddsAndChanges,
			unstaged: unstaged,
			unstagedStatus: unstaged > 0 ? `+${unstagedAdds} ~${unstagedChanges} -${unstagedDeletes}` : '',
			unstagedAddsAndChanges: unstagedAddsAndChanges
		};
	}

	static async show(
		status: GitStatus,
		goBackCommand?: CommandQuickPickItem
	): Promise<
		OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem | undefined
	> {
		const items = [
			...Iterables.flatMap(status.files, s => {
				if (s.workingTreeStatus !== undefined && s.indexStatus !== undefined) {
					return [
						new OpenStatusFileCommandQuickPickItem(s.with({ indexStatus: null }), s.indexStatus),
						new OpenStatusFileCommandQuickPickItem(s.with({ workTreeStatus: null }))
					];
				}

				return [new OpenStatusFileCommandQuickPickItem(s)];
			})
		] as (OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem)[];

		// Sort the status by staged and then filename
		items.sort(
			(a, b) =>
				((a as OpenStatusFileCommandQuickPickItem).status.staged ? -1 : 1) -
					((b as OpenStatusFileCommandQuickPickItem).status.staged ? -1 : 1) ||
				(a as OpenStatusFileCommandQuickPickItem).status.fileName.localeCompare(
					(b as OpenStatusFileCommandQuickPickItem).status.fileName,
					undefined,
					{ numeric: true, sensitivity: 'base' }
				)
		);

		const repoStatusCommandArgs: ShowQuickRepoStatusCommandArgs = {
			goBackCommand: goBackCommand
		};
		const currentCommand = new CommandQuickPickItem(
			{
				label: `go back ${GlyphChars.ArrowBack}`,
				description: `to status of ${GlyphChars.Space}$(git-branch) ${status.branch}`
			},
			Commands.ShowQuickRepoStatus,
			[undefined, repoStatusCommandArgs]
		);

		const computed = this.computeStatus(status.files);
		if (computed.staged > 0) {
			let index = 0;
			const unstagedIndex = computed.unstaged > 0 ? status.files.findIndex(f => !f.staged) : -1;
			if (unstagedIndex > -1) {
				items.splice(
					unstagedIndex,
					0,
					new CommandQuickPickItem(
						{
							label: 'Unstaged Files',
							description: computed.unstagedStatus
						},
						Commands.ShowQuickRepoStatus,
						[undefined, repoStatusCommandArgs]
					)
				);

				items.splice(
					unstagedIndex,
					0,
					new OpenStatusFilesCommandQuickPickItem(computed.stagedAddsAndChanges, {
						label: `${GlyphChars.Space.repeat(4)} $(file-symlink-file) Open Staged Files`,
						description: ''
					})
				);

				items.push(
					new OpenStatusFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, {
						label: `${GlyphChars.Space.repeat(4)} $(file-symlink-file) Open Unstaged Files`,
						description: ''
					})
				);
			}

			items.splice(
				index++,
				0,
				new CommandQuickPickItem(
					{
						label: 'Staged Files',
						description: computed.stagedStatus
					},
					Commands.ShowQuickRepoStatus,
					[undefined, repoStatusCommandArgs]
				)
			);
		} else if (status.files.some(f => !f.staged)) {
			items.splice(
				0,
				0,
				new CommandQuickPickItem(
					{
						label: 'Unstaged Files',
						description: computed.unstagedStatus
					},
					Commands.ShowQuickRepoStatus,
					[undefined, repoStatusCommandArgs]
				)
			);
		}

		if (status.files.length) {
			items.push(
				new OpenStatusFilesCommandQuickPickItem(
					computed.stagedAddsAndChanges.concat(computed.unstagedAddsAndChanges)
				)
			);
			items.push(
				new CommandQuickPickItem(
					{
						label: '$(x) Close Unchanged Files',
						description: ''
					},
					Commands.CloseUnchangedFiles
				)
			);
		} else {
			items.push(
				new CommandQuickPickItem(
					{
						label: 'No changes in the working tree',
						description: ''
					},
					Commands.ShowQuickRepoStatus,
					[undefined, repoStatusCommandArgs]
				)
			);
		}

		const stashListCommandArgs: ShowQuickStashListCommandArgs = {
			goBackCommand: currentCommand
		};
		items.splice(
			0,
			0,
			new CommandQuickPickItem(
				{
					label: '$(inbox) Show Stashes',
					description: 'shows stashed changes in the repository'
				},
				Commands.ShowQuickStashList,
				[GitUri.fromRepoPath(status.repoPath), stashListCommandArgs]
			)
		);

		if (status.upstream && status.state.ahead) {
			const branchHistoryCommandArgs: ShowQuickBranchHistoryCommandArgs = {
				branch: status.ref,
				maxCount: 0,
				goBackCommand: currentCommand
			};
			items.splice(
				0,
				0,
				new CommandQuickPickItem(
					{
						label: `$(cloud-upload)${GlyphChars.Space} ${status.state.ahead} Commit${
							status.state.ahead > 1 ? 's' : ''
						} ahead of ${GlyphChars.Space}$(git-branch) ${status.upstream}`,
						description: `shows commits in ${GlyphChars.Space}$(git-branch) ${status.branch} but not ${GlyphChars.Space}$(git-branch) ${status.upstream}`
					},
					Commands.ShowQuickBranchHistory,
					[
						GitUri.fromRepoPath(status.repoPath, `${status.upstream}..${status.ref}`),
						branchHistoryCommandArgs
					]
				)
			);
		}

		if (status.upstream && status.state.behind) {
			const branchHistoryCommandArgs: ShowQuickBranchHistoryCommandArgs = {
				branch: status.ref,
				maxCount: 0,
				goBackCommand: currentCommand
			};
			items.splice(
				0,
				0,
				new CommandQuickPickItem(
					{
						label: `$(cloud-download)${GlyphChars.Space} ${status.state.behind} Commit${
							status.state.behind > 1 ? 's' : ''
						} behind ${GlyphChars.Space}$(git-branch) ${status.upstream}`,
						description: `shows commits in ${GlyphChars.Space}$(git-branch) ${status.upstream} but not ${
							GlyphChars.Space
						}$(git-branch) ${status.branch}${
							status.sha
								? ` (since ${GlyphChars.Space}$(git-commit) ${GitService.shortenSha(status.sha)})`
								: ''
						}`
					},
					Commands.ShowQuickBranchHistory,
					[
						GitUri.fromRepoPath(status.repoPath, `${status.ref}..${status.upstream}`),
						branchHistoryCommandArgs
					]
				)
			);
		}

		if (status.upstream && !status.state.ahead && !status.state.behind) {
			items.splice(
				0,
				0,
				new CommandQuickPickItem(
					{
						label: `$(git-branch) ${status.branch} is up-to-date with ${GlyphChars.Space}$(git-branch) ${status.upstream}`,
						description: ''
					},
					Commands.ShowQuickRepoStatus,
					[undefined, repoStatusCommandArgs]
				)
			);
		}

		if (goBackCommand) {
			items.splice(0, 0, goBackCommand);
		}

		const scope = await Container.keyboard.beginScope({ left: goBackCommand });

		const pick = await window.showQuickPick(items, {
			matchOnDescription: true,
			placeHolder: `status of ${status.branch}${
				status.upstream ? ` ${Strings.pad(GlyphChars.ArrowsRightLeft, 1, 1)} ${status.upstream}` : ''
			}`,
			ignoreFocusOut: getQuickPickIgnoreFocusOut(),
			onDidSelectItem: (item: QuickPickItem) => {
				void scope.setKeyCommand('right', item);
			}
		});

		await scope.dispose();

		return pick;
	}
}
