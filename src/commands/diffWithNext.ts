'use strict';
import { Range, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, CommandContext, Commands, executeCommand, getCommandUri } from './common';
import { Container } from '../container';
import { DiffWithCommandArgs } from './diffWith';
import { GitLogCommit } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';

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

	protected preExecute(context: CommandContext, args?: DiffWithNextCommandArgs) {
		if (context.command === Commands.DiffWithNextInDiffLeft) {
			args = { ...args };
			args.inDiffLeftEditor = true;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithNextCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		const gitUri = args.commit != null ? GitUri.fromCommit(args.commit) : await GitUri.fromUri(uri);
		try {
			const diffUris = await Container.git.getNextDiffUris(
				gitUri.repoPath!,
				gitUri,
				gitUri.sha,
				// If we are in the left-side of the diff editor, we need to skip forward 1 more revision
				args.inDiffLeftEditor ? 1 : 0,
			);

			if (diffUris == null || diffUris.next == null) return;

			void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
				repoPath: diffUris.current.repoPath,
				lhs: {
					sha: diffUris.current.sha ?? '',
					uri: diffUris.current.documentUri(),
				},
				rhs: {
					sha: diffUris.next.sha ?? '',
					uri: diffUris.next.documentUri(),
				},
				line: args.line,
				showOptions: args.showOptions,
			}));
		} catch (ex) {
			Logger.error(
				ex,
				'DiffWithNextCommand',
				`getNextDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`,
			);
			void Messages.showGenericErrorMessage('Unable to open compare');
		}
	}
}
