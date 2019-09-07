'use strict';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitLogCommit, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, CommandContext, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffWithNextCommandArgs {
	commit?: GitLogCommit;
	range?: Range;

	inDiffLeftEditor?: boolean;
	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithNextCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.DiffWithNext, Commands.DiffWithNextInDiffLeft]);
	}

	protected preExecute(context: CommandContext, args: DiffWithNextCommandArgs = {}) {
		if (context.command === Commands.DiffWithNextInDiffLeft) {
			args.inDiffLeftEditor = true;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args: DiffWithNextCommandArgs = {}) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;

		args = { ...args };
		if (args.line === undefined) {
			args.line = editor == null ? 0 : editor.selection.active.line;
		}

		const gitUri = args.commit !== undefined ? GitUri.fromCommit(args.commit) : await GitUri.fromUri(uri);
		try {
			const diffUris = await Container.git.getNextDiffUris(
				gitUri.repoPath!,
				gitUri,
				gitUri.sha,
				// If we are in the left-side of the diff editor, we need to skip forward 1 more revision
				args.inDiffLeftEditor ? 1 : 0
			);

			if (diffUris === undefined || diffUris.next === undefined) return undefined;

			const diffArgs: DiffWithCommandArgs = {
				repoPath: diffUris.current.repoPath,
				lhs: {
					sha: diffUris.current.sha || '',
					uri: diffUris.current.documentUri()
				},
				rhs: {
					sha: diffUris.next.sha || '',
					uri: diffUris.next.documentUri()
				},
				line: args.line,
				showOptions: args.showOptions
			};
			return commands.executeCommand(Commands.DiffWith, diffArgs);
		} catch (ex) {
			Logger.error(
				ex,
				'DiffWithNextCommand',
				`getNextDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`
			);
			return Messages.showGenericErrorMessage('Unable to open compare');
		}
	}
}
