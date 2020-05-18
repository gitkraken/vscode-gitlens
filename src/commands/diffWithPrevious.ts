'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, CommandContext, Commands, findOrOpenEditor, getCommandUri } from './common';
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

		// Always pass the editor.uri (if we have one), so we are correct for a split diff
		return this.execute(context.editor, context.editor?.document.uri ?? context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithPreviousCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;

		args = { ...args };
		if (args.line === undefined) {
			args.line = editor == null ? 0 : editor.selection.active.line;
		}

		let gitUri;
		if (args.commit !== undefined) {
			if (!args.commit.isUncommitted) {
				const diffArgs: DiffWithCommandArgs = {
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
				};
				return commands.executeCommand(Commands.DiffWith, diffArgs);
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

			if (diffUris === undefined || diffUris.previous === undefined) {
				if (diffUris === undefined) return Messages.showCommitHasNoPreviousCommitWarningMessage();

				// If we have no previous and the current is the working file, just open the working file
				if (diffUris.current.sha === undefined) {
					return findOrOpenEditor(diffUris.current, args.showOptions);
				}

				if (!diffUris.current.isUncommittedStaged) {
					return Messages.showCommitHasNoPreviousCommitWarningMessage();
				}

				// If we have no previous and the current is staged, then diff staged with missing
				diffUris.previous = GitUri.fromFile(
					diffUris.current.fileName,
					diffUris.current.repoPath!,
					GitService.deletedOrMissingSha,
				);
			}

			const diffArgs: DiffWithCommandArgs = {
				repoPath: diffUris.current.repoPath,
				lhs: {
					sha: diffUris.previous.sha || '',
					uri: diffUris.previous.documentUri(),
				},
				rhs: {
					sha: diffUris.current.sha || '',
					uri: diffUris.current.documentUri(),
				},
				line: args.line,
				showOptions: args.showOptions,
			};
			return commands.executeCommand(Commands.DiffWith, diffArgs);
		} catch (ex) {
			Logger.error(
				ex,
				'DiffWithPreviousCommand',
				`getPreviousDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`,
			);
			return Messages.showGenericErrorMessage('Unable to open compare');
		}
	}
}
