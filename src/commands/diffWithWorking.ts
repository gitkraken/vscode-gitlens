'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { GitService, GitUri } from '../git/gitService';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffWithWorkingCommandArgs {
	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithWorkingCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.DiffWithWorking);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithWorkingCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		if (args.line === undefined) {
			args.line = editor == null ? 0 : editor.selection.active.line;
		}

		// if (args.commit === undefined || args.commit.isUncommitted) {
		// If the sha is missing, just let the user know the file matches
		if (gitUri.sha === undefined) return window.showInformationMessage('File matches the working tree');
		if (gitUri.sha === GitService.deletedOrMissingSha) {
			return window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');
		}

		// If we are a fake "staged" sha, check the status
		if (gitUri.isUncommittedStaged) {
			const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
			if (status !== undefined && status.indexStatus !== undefined) {
				const diffArgs: DiffWithCommandArgs = {
					repoPath: gitUri.repoPath,
					lhs: {
						sha: GitService.uncommittedStagedSha,
						uri: gitUri.documentUri()
					},
					rhs: {
						sha: '',
						uri: gitUri.documentUri()
					},
					line: args.line,
					showOptions: args.showOptions
				};

				return commands.executeCommand(Commands.DiffWith, diffArgs);
			}
		}

		uri = gitUri.toFileUri();

		const workingUri = await Container.git.getWorkingUri(gitUri.repoPath!, uri);
		if (workingUri === undefined) {
			return window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');
		}

		const diffArgs: DiffWithCommandArgs = {
			repoPath: gitUri.repoPath,
			lhs: {
				sha: gitUri.sha,
				uri: uri
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
