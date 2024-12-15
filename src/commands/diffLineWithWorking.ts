import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { uncommittedStaged } from '../git/models/revision';
import { showFileNotUnderSourceControlWarningMessage, showGenericErrorMessage } from '../messages';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffLineWithWorkingCommandArgs {
	commit?: GitCommit;

	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffLineWithWorkingCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.DiffLineWithWorking);
	}

	protected override preExecute(context: CommandContext, args?: DiffLineWithWorkingCommandArgs): Promise<any> {
		if (context.type === 'editorLine') {
			args = { ...args, line: context.line };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffLineWithWorkingCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		let lhsSha: string;
		let lhsUri: Uri;

		if (args.commit == null || args.commit.isUncommitted) {
			const blameline = args.line;
			if (blameline < 0) return;

			try {
				const blame = await this.container.git.getBlameForLine(gitUri, blameline, editor?.document);
				if (blame == null) {
					void showFileNotUnderSourceControlWarningMessage('Unable to open compare');

					return;
				}

				args.commit = blame.commit;

				// If the line is uncommitted, use previous commit (or index if the file is staged)
				if (args.commit.isUncommitted) {
					const status = await this.container.git.getStatusForFile(gitUri.repoPath!, gitUri);
					if (status?.indexStatus != null) {
						lhsSha = uncommittedStaged;
						lhsUri = this.container.git.getAbsoluteUri(
							status.originalPath || status.path,
							args.commit.repoPath,
						);
					} else {
						// Don't need to worry about verifying the previous sha, as the DiffWith command will
						lhsSha = args.commit.unresolvedPreviousSha;
						lhsUri = args.commit.file!.originalUri ?? args.commit.file!.uri;
					}
				} else {
					lhsSha = args.commit.sha;
					lhsUri = args.commit.file!.uri;
				}
				// editor lines are 0-based
				args.line = blame.line.line - 1;
			} catch (ex) {
				Logger.error(ex, 'DiffLineWithWorkingCommand', `getBlameForLine(${blameline})`);
				void showGenericErrorMessage('Unable to open compare');

				return;
			}
		} else {
			lhsSha = args.commit.sha;
			lhsUri = args.commit.file?.uri ?? gitUri;
		}

		const workingUri = await args.commit.file?.getWorkingUri();
		if (workingUri == null) {
			void window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');

			return;
		}

		void (await executeCommand<DiffWithCommandArgs>(GlCommand.DiffWith, {
			repoPath: args.commit.repoPath,
			lhs: {
				sha: lhsSha,
				uri: lhsUri,
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
