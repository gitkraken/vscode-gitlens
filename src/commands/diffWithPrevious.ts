'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitRevision } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	executeCommand,
	findOrOpenEditor,
	getCommandUri,
} from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffWithPreviousCommandArgs {
	commit?: GitCommit;

	inDiffRightEditor?: boolean;
	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithPreviousCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.DiffWithPrevious, Commands.DiffWithPreviousInDiffRight]);
	}

	protected preExecute(context: CommandContext, args?: DiffWithPreviousCommandArgs) {
		if (context.command === Commands.DiffWithPreviousInDiffRight) {
			args = { ...args };

			// Ensure we are on the right side -- context.uri is always the right-side uri, so ensure the editor matches, otherwise we are on the left
			if (context.editor?.document.uri.toString() === context.uri?.toString()) {
				args.inDiffRightEditor = true;
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithPreviousCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		let gitUri;
		if (args.commit != null) {
			if (!args.commit.isUncommitted) {
				void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
					repoPath: args.commit.repoPath,
					lhs: {
						sha: `${args.commit.sha}^`,
						uri: args.commit.originalUri,
					},
					rhs: {
						sha: args.commit.sha || '',
						uri: args.commit.uri,
					},
					line: args.line,
					showOptions: args.showOptions,
				}));

				return;
			}

			gitUri = GitUri.fromCommit(args.commit);
		} else {
			gitUri = await GitUri.fromUri(uri);
		}

		// If we are in the right diff editor, we can't really trust the line number
		// if (args.inDiffRightEditor && args.line !== 0) {
		// 	// TODO@eamodio figure out how to tell where the line moved in the previous commit (if at all)
		// }

		try {
			const diffUris = await Container.git.getPreviousDiffUris(
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
