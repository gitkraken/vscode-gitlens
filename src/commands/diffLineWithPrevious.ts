import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { showCommitHasNoPreviousCommitWarningMessage, showGenericErrorMessage } from '../messages';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffLineWithPreviousCommandArgs {
	commit?: GitCommit;

	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffLineWithPreviousCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.DiffLineWithPrevious);
	}

	protected override preExecute(context: CommandContext, args?: DiffLineWithPreviousCommandArgs): Promise<any> {
		if (context.type === 'editorLine') {
			args = { ...args, line: context.line };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffLineWithPreviousCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		const gitUri = args.commit?.getGitUri() ?? (await GitUri.fromUri(uri));

		try {
			const diffUris = await this.container.git.getPreviousComparisonUrisForLine(
				gitUri.repoPath!,
				gitUri,
				args.line,
				gitUri.sha,
			);

			if (diffUris?.previous == null) {
				void showCommitHasNoPreviousCommitWarningMessage();

				return;
			}

			void (await executeCommand<DiffWithCommandArgs>(GlCommand.DiffWith, {
				repoPath: diffUris.current.repoPath,
				lhs: {
					sha: diffUris.previous.sha ?? '',
					uri: diffUris.previous.documentUri(),
				},
				rhs: {
					sha: diffUris.current.sha ?? '',
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
			void showGenericErrorMessage('Unable to open compare');
		}
	}
}
