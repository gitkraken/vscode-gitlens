'use strict';
import { TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { SearchPattern } from '../git/git';
import { GitUri } from '../git/gitUri';
import { executeGitCommand } from '../commands';
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
								editor.document.getText(),
						  )
						: await Container.git.getBlameForRange(gitUri, editor.selection);
					if (blame === undefined) {
						return Messages.showFileNotUnderSourceControlWarningMessage('Unable to find commits');
					}

					args.refs = [
						...Iterables.filterMap(blame.commits.values(), c => (c.isUncommitted ? undefined : c.ref)),
					];
				} catch (ex) {
					Logger.error(ex, 'ShowCommitsInViewCommand', 'getBlameForRange');
					return Messages.showGenericErrorMessage('Unable to find commits');
				}
			} else {
				if (gitUri.sha == null) return undefined;

				args.refs = [gitUri.sha];
			}
		}

		return executeGitCommand({
			command: 'search',
			state: {
				repo: args?.repoPath,
				pattern: SearchPattern.fromCommits(args.refs),
				showResultsInSideBar: true,
			},
		});
	}
}
