import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { GitCommit, GitRevision } from '../git/models';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { command, executeCommand } from '../system/command';
import { findOrOpenEditor } from '../system/utils';
import { ActiveEditorCommand, CommandContext, getCommandUri } from './base';
import { DiffWithCommandArgs } from './diffWith';

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
		super([Commands.DiffWithPrevious, Commands.DiffWithPreviousInDiffLeft, Commands.DiffWithPreviousInDiffRight]);
	}

	protected override preExecute(context: CommandContext, args?: DiffWithPreviousCommandArgs) {
		if (context.command === Commands.DiffWithPreviousInDiffRight) {
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
				void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
					repoPath: args.commit.repoPath,
					lhs: {
						sha: `${args.commit.sha}^`,
						uri: args.commit.file.originalUri ?? args.commit.file.uri,
					},
					rhs: {
						sha: args.commit.sha || '',
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

			if (diffUris == null || diffUris.previous == null) {
				if (diffUris == null) {
					void Messages.showCommitHasNoPreviousCommitWarningMessage();

					return;
				}

				// If we have no previous and the current is the working file, just open the working file
				if (diffUris.current.sha == null) {
					void (await findOrOpenEditor(diffUris.current, args.showOptions));

					return;
				}

				if (!diffUris.current.isUncommittedStaged) {
					void Messages.showCommitHasNoPreviousCommitWarningMessage();

					return;
				}

				// If we have no previous and the current is staged, then diff staged with missing
				diffUris.previous = GitUri.fromFile(
					diffUris.current.fileName,
					diffUris.current.repoPath!,
					GitRevision.deletedOrMissing,
				);
			}

			void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
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
			void Messages.showGenericErrorMessage('Unable to open compare');
		}
	}
}
