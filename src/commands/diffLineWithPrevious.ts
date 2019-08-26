'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffLineWithPreviousCommandArgs {
	commit?: GitCommit;

	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffLineWithPreviousCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.DiffLineWithPrevious);
	}

	async execute(editor?: TextEditor, uri?: Uri, args: DiffLineWithPreviousCommandArgs = {}): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;

		args = { ...args };
		if (args.line === undefined) {
			args.line = editor == null ? 0 : editor.selection.active.line;
		}

		const gitUri = args.commit !== undefined ? GitUri.fromCommit(args.commit) : await GitUri.fromUri(uri);

		try {
			const diffUris = await Container.git.getPreviousLineDiffUris(
				gitUri.repoPath!,
				gitUri,
				args.line,
				gitUri.sha
			);

			if (diffUris === undefined || diffUris.previous === undefined) {
				return Messages.showCommitHasNoPreviousCommitWarningMessage();
			}

			const diffArgs: DiffWithCommandArgs = {
				repoPath: diffUris.current.repoPath,
				lhs: {
					sha: diffUris.previous.sha || '',
					uri: diffUris.previous.documentUri()
				},
				rhs: {
					sha: diffUris.current.sha || '',
					uri: diffUris.current.documentUri()
				},
				line: args.line,
				showOptions: args.showOptions
			};
			return commands.executeCommand(Commands.DiffWith, diffArgs);
		} catch (ex) {
			Logger.error(
				ex,
				'DiffLineWithPreviousCommand',
				`getPreviousLineDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`
			);
			return Messages.showGenericErrorMessage('Unable to open compare');
		}
	}
}
