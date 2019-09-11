'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitCommit, GitLog, GitLogCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, CommitFileQuickPick } from '../quickpicks';
import {
	ActiveEditorCachedCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	isCommandViewContextWithCommit
} from './common';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

export interface ShowQuickCommitFileDetailsCommandArgs {
	sha?: string;
	commit?: GitCommit | GitLogCommit;
	fileLog?: GitLog;
	revisionUri?: string;

	goBackCommand?: CommandQuickPickItem;
}

@command()
export class ShowQuickCommitFileDetailsCommand extends ActiveEditorCachedCommand {
	static getMarkdownCommandArgs(args: ShowQuickCommitFileDetailsCommandArgs): string {
		return super.getMarkdownCommandArgsCore<ShowQuickCommitFileDetailsCommandArgs>(
			Commands.ShowQuickCommitFileDetails,
			args
		);
	}

	constructor() {
		super([Commands.ShowQuickCommitFileDetails, Commands.ShowQuickRevisionDetails]);
	}

	protected async preExecute(context: CommandContext, args?: ShowQuickCommitFileDetailsCommandArgs) {
		if (context.command === Commands.ShowQuickRevisionDetails && context.editor !== undefined) {
			args = { ...args };

			const gitUri = await GitUri.fromUri(context.editor.document.uri);
			args.sha = gitUri.sha;
		}

		if (context.type === 'viewItem') {
			args = { ...args };
			args.sha = context.node.uri.sha;

			if (isCommandViewContextWithCommit(context)) {
				args.commit = context.node.commit;
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickCommitFileDetailsCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;

		args = { ...args };

		let gitUri;
		if (args.revisionUri !== undefined) {
			gitUri = GitUri.fromRevisionUri(Uri.parse(args.revisionUri));
			args.sha = gitUri.sha;
		} else {
			gitUri = await GitUri.fromUri(uri);
		}

		if (args.sha === undefined) {
			if (editor == null) return undefined;

			const blameline = editor.selection.active.line;
			if (blameline < 0) return undefined;

			try {
				const blame = await Container.git.getBlameForLine(gitUri, blameline);
				if (blame === undefined) {
					return Messages.showFileNotUnderSourceControlWarningMessage('Unable to show commit file details');
				}

				// Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
				if (blame.commit.isUncommitted) {
					return Messages.showLineUncommittedWarningMessage('Unable to show commit file details');
				}

				args.sha = blame.commit.sha;

				args.commit = blame.commit;
			} catch (ex) {
				Logger.error(ex, 'ShowQuickCommitFileDetailsCommand', `getBlameForLine(${blameline})`);
				return window.showErrorMessage(
					'Unable to show commit file details. See output channel for more details'
				);
			}
		}

		try {
			if (args.commit === undefined || !args.commit.isFile) {
				if (args.fileLog !== undefined) {
					args.commit = args.fileLog.commits.get(args.sha);
					// If we can't find the commit, kill the fileLog
					if (args.commit === undefined) {
						args.fileLog = undefined;
					}
				}

				if (args.fileLog === undefined) {
					const repoPath = args.commit === undefined ? gitUri.repoPath : args.commit.repoPath;
					args.commit = await Container.git.getCommitForFile(repoPath, gitUri.fsPath, { ref: args.sha });
					if (args.commit === undefined) {
						return Messages.showCommitNotFoundWarningMessage('Unable to show commit file details');
					}
				}
			}

			if (args.commit === undefined) {
				return Messages.showCommitNotFoundWarningMessage('Unable to show commit file details');
			}

			const shortSha = GitService.shortenSha(args.sha);

			if (args.goBackCommand === undefined) {
				const commandArgs: ShowQuickCommitDetailsCommandArgs = {
					commit: args.commit,
					sha: args.sha
				};

				// Create a command to get back to the commit details
				args.goBackCommand = new CommandQuickPickItem(
					{
						label: `go back ${GlyphChars.ArrowBack}`,
						description: `to details of ${GlyphChars.Space}$(git-commit) ${shortSha}`
					},
					Commands.ShowQuickCommitDetails,
					[args.commit.toGitUri(), commandArgs]
				);
			}

			// Create a command to get back to where we are right now
			const currentCommand = new CommandQuickPickItem(
				{
					label: `go back ${GlyphChars.ArrowBack}`,
					description: `to details of ${args.commit.getFormattedPath()} from ${
						GlyphChars.Space
					}$(git-commit) ${shortSha}`
				},
				Commands.ShowQuickCommitFileDetails,
				[args.commit.toGitUri(), args]
			);

			const pick = await CommitFileQuickPick.show(
				args.commit as GitLogCommit,
				uri,
				args.goBackCommand,
				currentCommand,
				args.fileLog
			);
			if (pick === undefined) return undefined;

			if (pick instanceof CommandQuickPickItem) return pick.execute();

			return undefined;
		} catch (ex) {
			Logger.error(ex, 'ShowQuickCommitFileDetailsCommand');
			return Messages.showGenericErrorMessage('Unable to show commit file details');
		}
	}
}
