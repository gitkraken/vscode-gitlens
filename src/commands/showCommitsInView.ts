import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { showDetailsView } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { createReference } from '../git/models/reference';
import { createSearchQueryForCommits } from '../git/search';
import { showFileNotUnderSourceControlWarningMessage, showGenericErrorMessage } from '../messages';
import { command } from '../system/command';
import { filterMap } from '../system/iterable';
import { Logger } from '../system/logger';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri, isCommandContextViewNodeHasCommit } from './base';

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
		return super.getMarkdownCommandArgsCore<ShowCommitsInViewCommandArgs>(Commands.ShowCommitInView, args);
	}

	constructor(private readonly container: Container) {
		super([Commands.ShowCommitInView, Commands.ShowInDetailsView, Commands.ShowCommitsInView]);
	}

	protected override preExecute(context: CommandContext, args?: ShowCommitsInViewCommandArgs) {
		if (context.type === 'viewItem') {
			args = { ...args };
			if (isCommandContextViewNodeHasCommit(context)) {
				args.refs = [context.node.commit.sha];
				args.repoPath = context.node.commit.repoPath;
			}
		}

		return this.execute(context.editor, context.uri, args);
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
						? await this.container.git.getBlameForRangeContents(
								gitUri,
								editor.selection,
								editor.document.getText(),
						  )
						: await this.container.git.getBlameForRange(gitUri, editor.selection);
					if (blame === undefined) {
						return showFileNotUnderSourceControlWarningMessage('Unable to find commits');
					}

					args.refs = [...filterMap(blame.commits.values(), c => (c.isUncommitted ? undefined : c.ref))];
				} catch (ex) {
					Logger.error(ex, 'ShowCommitsInViewCommand', 'getBlameForRange');
					return showGenericErrorMessage('Unable to find commits');
				}
			} else {
				if (gitUri.sha == null) return undefined;

				args.refs = [gitUri.sha];
			}
		}

		if (args.refs.length === 1) {
			return showDetailsView(createReference(args.refs[0], args.repoPath!, { refType: 'revision' }));
		}

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
