'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, Commands, executeCommand, getCommandUri } from './common';
import { Container } from '../container';
import { DiffWithCommandArgs } from './diffWith';
import { GitCommit } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';

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

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffLineWithPreviousCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		const gitUri = args.commit != null ? GitUri.fromCommit(args.commit) : await GitUri.fromUri(uri);

		try {
			const diffUris = await Container.git.getPreviousLineDiffUris(
				gitUri.repoPath!,
				gitUri,
				args.line,
				gitUri.sha,
			);

			if (diffUris == null || diffUris.previous == null) {
				Messages.showCommitHasNoPreviousCommitWarningMessage();

				return;
			}

			void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
				repoPath: diffUris.current.repoPath,
				lhs: {
					sha: diffUris.previous.sha || '',
					uri: diffUris.previous.documentUri(),
				},
				rhs: {
					sha: diffUris.current.sha || '',
					uri: diffUris.current.documentUri(),
				},
				line: diffUris.line,
				showOptions: args.showOptions,
			}));
		} catch (ex) {
			Logger.error(
				ex,
				'DiffLineWithPreviousCommand',
				`getPreviousLineDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`,
			);
			Messages.showGenericErrorMessage('Unable to open compare');
		}
	}
}
