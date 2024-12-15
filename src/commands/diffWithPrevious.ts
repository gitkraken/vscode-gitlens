import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { deletedOrMissing } from '../git/models/revision';
import { showCommitHasNoPreviousCommitWarningMessage, showGenericErrorMessage } from '../messages';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import { findOrOpenEditor } from '../system/vscode/utils';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffWithPreviousCommandArgs {
	commit?: GitCommit;

	inDiffRightEditor?: boolean;
	uri?: Uri;
	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithPreviousCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			GlCommand.DiffWithPrevious,
			GlCommand.DiffWithPreviousInDiffLeft,
			GlCommand.DiffWithPreviousInDiffRight,
		]);
	}

	protected override preExecute(context: CommandContext, args?: DiffWithPreviousCommandArgs) {
		if (context.command === GlCommand.DiffWithPreviousInDiffRight) {
			args = { ...args, inDiffRightEditor: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithPreviousCommandArgs) {
		args = { ...args };
		if (args.uri == null) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return;
		} else {
			uri = args.uri;
		}

		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		let gitUri;
		if (args.commit?.file != null) {
			if (!args.commit.isUncommitted) {
				void (await executeCommand<DiffWithCommandArgs>(GlCommand.DiffWith, {
					repoPath: args.commit.repoPath,
					lhs: {
						sha: `${args.commit.sha}^`,
						uri: args.commit.file.originalUri ?? args.commit.file.uri,
					},
					rhs: {
						// If the file is `?` (untracked), then this must be a stash, so get the ^3 commit to access the untracked file
						sha: args.commit.file.status === '?' ? `${args.commit.sha}^3` : args.commit.sha || '',
						uri: args.commit.file.uri,
					},
					line: args.line,
					showOptions: args.showOptions,
				}));

				return;
			}

			gitUri = args.commit?.getGitUri();
		} else {
			gitUri = await GitUri.fromUri(uri);
		}

		// If we are in the right diff editor, we can't really trust the line number
		// if (args.inDiffRightEditor && args.line !== 0) {
		// 	// TODO@eamodio figure out how to tell where the line moved in the previous commit (if at all)
		// }

		try {
			const diffUris = await this.container.git.getPreviousComparisonUris(
				gitUri.repoPath!,
				gitUri,
				gitUri.sha,
				// If we are in the right-side of the diff editor, we need to skip back 1 more revision
				args.inDiffRightEditor ? 1 : 0,
			);

			if (diffUris?.previous == null) {
				if (diffUris == null) {
					void showCommitHasNoPreviousCommitWarningMessage();

					return;
				}

				// If we have no previous and the current is the working file, just open the working file
				if (diffUris.current.sha == null) {
					void (await findOrOpenEditor(diffUris.current, args.showOptions));

					return;
				}

				if (!diffUris.current.isUncommittedStaged) {
					void showCommitHasNoPreviousCommitWarningMessage();

					return;
				}

				// If we have no previous and the current is staged, then diff staged with missing
				diffUris.previous = GitUri.fromFile(
					diffUris.current.fileName,
					diffUris.current.repoPath!,
					deletedOrMissing,
				);
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
				line: args.line,
				showOptions: args.showOptions,
			}));
		} catch (ex) {
			Logger.error(
				ex,
				'DiffWithPreviousCommand',
				`getPreviousDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`,
			);
			void showGenericErrorMessage('Unable to open compare');
		}
	}
}
