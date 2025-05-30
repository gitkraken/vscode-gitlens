import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { GitUri } from '../git/gitUri';
import { createSearchQueryForCommits } from '../git/search';
import { showFileNotUnderSourceControlWarningMessage, showGenericErrorMessage } from '../messages';
import { command } from '../system/command';
import { filterMap } from '../system/iterable';
import { Logger } from '../system/logger';
import { ActiveEditorCommand, getCommandUri } from './base';

export interface ShowCommitsInViewCommandArgs {
	refs?: string[];
	repoPath?: string;
}

@command()
export class ShowCommitsInViewCommand extends ActiveEditorCommand {
	static getMarkdownCommandArgs(sha: string, repoPath: string): string;
	static getMarkdownCommandArgs(args: ShowCommitsInViewCommandArgs): string;
	static getMarkdownCommandArgs(argsOrSha: ShowCommitsInViewCommandArgs | string, repoPath?: string): string {
		const args = typeof argsOrSha === 'string' ? { refs: [argsOrSha], repoPath: repoPath } : argsOrSha;
		return super.getMarkdownCommandArgsCore<ShowCommitsInViewCommandArgs>(Commands.ShowCommitsInView, args);
	}

	constructor(private readonly container: Container) {
		super(Commands.ShowCommitsInView);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowCommitsInViewCommandArgs) {
		args = { ...args };

		if (args.refs == null) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return undefined;

			const gitUri = await GitUri.fromUri(uri);

			args.repoPath = gitUri.repoPath;

			if (editor != null) {
				try {
					// Check for any uncommitted changes in the range
					const blame = editor.document.isDirty
						? await this.container.git.getBlameForRangeContents(
								gitUri,
								editor.selection,
								editor.document.getText(),
						  )
						: await this.container.git.getBlameForRange(gitUri, editor.selection);
					if (blame === undefined) {
						return void showFileNotUnderSourceControlWarningMessage('Unable to find commits');
					}

					args.refs = [...filterMap(blame.commits.values(), c => (c.isUncommitted ? undefined : c.ref))];
				} catch (ex) {
					Logger.error(ex, 'ShowCommitsInViewCommand', 'getBlameForRange');
					return void showGenericErrorMessage('Unable to find commits');
				}
			} else {
				if (gitUri.sha == null) return undefined;

				args.refs = [gitUri.sha];
			}
		}

		// if (args.refs.length === 1) {
		// 	return showDetailsView(createReference(args.refs[0], args.repoPath!, { refType: 'revision' }));
		// }

		return executeGitCommand({
			command: 'search',
			state: {
				repo: args?.repoPath,
				query: createSearchQueryForCommits(args.refs),
				showResultsInSideBar: true,
			},
		});
	}
}
