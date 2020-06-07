'use strict';
import { TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, command, CommandContext, Commands, executeCommand, getCommandUri } from './common';
import { Container } from '../container';
import { DiffWithCommandArgs } from './diffWith';
import { GitRevision } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface DiffWithWorkingCommandArgs {
	inDiffRightEditor?: boolean;
	uri?: Uri;
	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithWorkingCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.DiffWithWorking, Commands.DiffWithWorkingInDiffRight]);
	}

	protected preExecute(context: CommandContext, args?: DiffWithWorkingCommandArgs) {
		if (context.command === Commands.DiffWithWorkingInDiffRight) {
			args = { ...args };

			// Ensure we are on the right side -- context.uri is always the right-side uri, so ensure the editor matches, otherwise we are on the left
			if (context.editor?.document.uri.toString() === context.uri?.toString()) {
				args.inDiffRightEditor = true;
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithWorkingCommandArgs): Promise<any> {
		args = { ...args };
		if (args.uri == null) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return;
		} else {
			uri = args.uri;
		}

		let gitUri = await GitUri.fromUri(uri);

		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		if (args.inDiffRightEditor) {
			try {
				const diffUris = await Container.git.getPreviousDiffUris(gitUri.repoPath!, gitUri, gitUri.sha, 0);
				gitUri = diffUris?.previous ?? gitUri;
			} catch (ex) {
				Logger.error(
					ex,
					'DiffWithWorkingCommand',
					`getPreviousDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`,
				);
				void Messages.showGenericErrorMessage('Unable to open compare');

				return;
			}
		}

		// If the sha is missing, just let the user know the file matches
		if (gitUri.sha == null) {
			void window.showInformationMessage('File matches the working tree');

			return;
		}
		if (gitUri.sha === GitRevision.deletedOrMissing) {
			void window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');

			return;
		}

		// If we are a fake "staged" sha, check the status
		if (gitUri.isUncommittedStaged) {
			const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
			if (status?.indexStatus != null) {
				void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
					repoPath: gitUri.repoPath,
					lhs: {
						sha: GitRevision.uncommittedStaged,
						uri: gitUri.documentUri(),
					},
					rhs: {
						sha: '',
						uri: gitUri.documentUri(),
					},
					line: args.line,
					showOptions: args.showOptions,
				}));

				return;
			}
		}

		uri = gitUri.toFileUri();

		const workingUri = await Container.git.getWorkingUri(gitUri.repoPath!, uri);
		if (workingUri == null) {
			void window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');

			return;
		}

		void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
			repoPath: gitUri.repoPath,
			lhs: {
				sha: gitUri.sha,
				uri: uri,
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
