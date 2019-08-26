'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffLineWithWorkingCommandArgs {
	commit?: GitCommit;

	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffLineWithWorkingCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.DiffLineWithWorking);
	}

	async execute(editor?: TextEditor, uri?: Uri, args: DiffLineWithWorkingCommandArgs = {}): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		if (args.line === undefined) {
			args.line = editor == null ? 0 : editor.selection.active.line;
		}

		if (args.commit === undefined || args.commit.isUncommitted) {
			const blameline = args.line;
			if (blameline < 0) return undefined;

			try {
				const blame =
					editor && editor.document && editor.document.isDirty
						? await Container.git.getBlameForLineContents(gitUri, blameline, editor.document.getText())
						: await Container.git.getBlameForLine(gitUri, blameline);
				if (blame === undefined) {
					return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
				}

				args.commit = blame.commit;

				// If the line is uncommitted, change the previous commit
				if (args.commit.isUncommitted) {
					const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
					args.commit = args.commit.with({
						sha:
							status !== undefined && status.indexStatus !== undefined
								? GitService.uncommittedStagedSha
								: args.commit.previousSha!,
						fileName: args.commit.previousFileName!,
						originalFileName: null,
						previousSha: null,
						previousFileName: null
					});
					// editor lines are 0-based
					args.line = blame.line.line - 1;
				}
			} catch (ex) {
				Logger.error(ex, 'DiffLineWithWorkingCommand', `getBlameForLine(${blameline})`);
				return Messages.showGenericErrorMessage('Unable to open compare');
			}
		}

		const workingUri = await args.commit.getWorkingUri();
		if (workingUri === undefined) {
			return window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');
		}

		const diffArgs: DiffWithCommandArgs = {
			repoPath: args.commit.repoPath,
			lhs: {
				sha: args.commit.sha,
				uri: args.commit.uri
			},
			rhs: {
				sha: '',
				uri: workingUri
			},
			line: args.line,
			showOptions: args.showOptions
		};
		return commands.executeCommand(Commands.DiffWith, diffArgs);
	}
}
