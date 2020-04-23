'use strict';
import { TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, command, Commands, executeCommand, getCommandUri } from './common';
import { Container } from '../container';
import { DiffWithCommandArgs } from './diffWith';
import { GitCommit, GitRevision } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';

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

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffLineWithWorkingCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		if (args.commit == null || args.commit.isUncommitted) {
			const blameline = args.line;
			if (blameline < 0) return;

			try {
				const blame = editor?.document.isDirty
					? await Container.git.getBlameForLineContents(gitUri, blameline, editor.document.getText())
					: await Container.git.getBlameForLine(gitUri, blameline);
				if (blame == null) {
					Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

					return;
				}

				args.commit = blame.commit;

				// If the line is uncommitted, change the previous commit
				if (args.commit.isUncommitted) {
					const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
					args.commit = args.commit.with({
						sha: status?.indexStatus != null ? GitRevision.uncommittedStaged : args.commit.previousSha!,
						fileName: args.commit.previousFileName!,
						originalFileName: null,
						previousSha: null,
						previousFileName: null,
					});
					// editor lines are 0-based
					args.line = blame.line.line - 1;
				}
			} catch (ex) {
				Logger.error(ex, 'DiffLineWithWorkingCommand', `getBlameForLine(${blameline})`);
				Messages.showGenericErrorMessage('Unable to open compare');

				return;
			}
		}

		const workingUri = await args.commit.getWorkingUri();
		if (workingUri == null) {
			window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');

			return;
		}

		void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
			repoPath: args.commit.repoPath,
			lhs: {
				sha: args.commit.sha,
				uri: args.commit.uri,
			},
			rhs: {
				sha: '',
				uri: workingUri,
			},
			line: args.line,
			showOptions: args.showOptions,
		}));
	}
}
