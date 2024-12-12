import type { Range, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { showGenericErrorMessage } from '../messages';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffWithNextCommandArgs {
	commit?: GitCommit;
	range?: Range;

	inDiffLeftEditor?: boolean;
	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithNextCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([GlCommand.DiffWithNext, GlCommand.DiffWithNextInDiffLeft, GlCommand.DiffWithNextInDiffRight]);
	}

	protected override preExecute(context: CommandContext, args?: DiffWithNextCommandArgs) {
		if (context.command === GlCommand.DiffWithNextInDiffLeft) {
			args = { ...args, inDiffLeftEditor: true };
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

		const gitUri = args.commit?.getGitUri() ?? (await GitUri.fromUri(uri));
		try {
			const diffUris = await this.container.git.getNextComparisonUris(
				gitUri.repoPath!,
				gitUri,
				gitUri.sha,
				// If we are in the left-side of the diff editor, we need to skip forward 1 more revision
				args.inDiffLeftEditor ? 1 : 0,
			);

			if (diffUris?.next == null) return;

			void (await executeCommand<DiffWithCommandArgs>(GlCommand.DiffWith, {
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
			void showGenericErrorMessage('Unable to open compare');
		}
	}
}
