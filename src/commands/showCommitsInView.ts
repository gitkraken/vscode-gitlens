'use strict';
import { commands, TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { GitUri, SearchPattern } from '../git/gitService';
import { GitCommandsCommandArgs } from '../commands';
import { Messages } from '../messages';
import { Iterables } from '../system';
import { Logger } from '../logger';

export interface ShowCommitsInViewCommandArgs {
	refs?: string[];
	repoPath?: string;
}

@command()
export class ShowCommitsInViewCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.ShowCommitInView, Commands.ShowCommitsInView]);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowCommitsInViewCommandArgs) {
		args = { ...args };

		if (args.refs === undefined) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return undefined;

			const gitUri = await GitUri.fromUri(uri);

			args.repoPath = gitUri.repoPath;

			if (editor != null) {
				try {
					// Check for any uncommitted changes in the range
					const blame = editor.document.isDirty
						? await Container.git.getBlameForRangeContents(
								gitUri,
								editor.selection,
								editor.document.getText()
						  )
						: await Container.git.getBlameForRange(gitUri, editor.selection);
					if (blame === undefined) {
						return Messages.showFileNotUnderSourceControlWarningMessage(
							'Unable to show commits in Search Commits view'
						);
					}

					args.refs = [
						...Iterables.filterMap(blame.commits.values(), c => (c.isUncommitted ? undefined : c.ref))
					];
				} catch (ex) {
					Logger.error(ex, 'ShowCommitsInViewCommand', 'getBlameForRange');
					return Messages.showGenericErrorMessage('Unable to show commits in Search Commits view');
				}
			} else {
				if (gitUri.sha == null) return undefined;

				args.refs = [gitUri.sha];
			}
		}

		let repo;
		if (args.repoPath !== undefined) {
			repo = await Container.git.getRepository(args.repoPath);
		}

		const gitCommandArgs: GitCommandsCommandArgs = {
			command: 'search',
			state: {
				repo: repo,
				pattern: SearchPattern.fromCommits(args.refs),
				showResultsInView: true
			}
		};
		return commands.executeCommand(Commands.GitCommands, gitCommandArgs);
	}
}
