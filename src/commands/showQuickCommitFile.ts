'use strict';
import { TextEditor, Uri, window } from 'vscode';
import {
	ActiveEditorCachedCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	isCommandViewContextWithCommit,
} from './common';
import { Container } from '../container';
import { GitBlameCommit, GitCommit, GitLog, GitLogCommit } from '../git/git';
import { executeGitCommand } from './gitCommands';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface ShowQuickCommitFileCommandArgs {
	sha?: string;
	commit?: GitCommit | GitLogCommit;
	fileLog?: GitLog;
	revisionUri?: string;
}

@command()
export class ShowQuickCommitFileCommand extends ActiveEditorCachedCommand {
	static getMarkdownCommandArgs(args: ShowQuickCommitFileCommandArgs): string {
		return super.getMarkdownCommandArgsCore<ShowQuickCommitFileCommandArgs>(Commands.ShowQuickCommitFile, args);
	}

	constructor() {
		super([Commands.ShowQuickCommitFile, Commands.ShowQuickCommitRevision]);
	}

	protected async preExecute(context: CommandContext, args?: ShowQuickCommitFileCommandArgs) {
		if (context.command === Commands.ShowQuickCommitRevision && context.editor !== undefined) {
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

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickCommitFileCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		args = { ...args };

		let gitUri;
		if (args.revisionUri !== undefined) {
			gitUri = GitUri.fromRevisionUri(Uri.parse(args.revisionUri));
			args.sha = gitUri.sha;
		} else {
			gitUri = await GitUri.fromUri(uri);
		}

		if (args.sha === undefined) {
			if (editor == null) return;

			const blameline = editor.selection.active.line;
			if (blameline < 0) return;

			try {
				const blame = await Container.git.getBlameForLine(gitUri, blameline);
				if (blame == null) {
					Messages.showFileNotUnderSourceControlWarningMessage('Unable to show commit file details');

					return;
				}

				// Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
				if (blame.commit.isUncommitted) {
					Messages.showLineUncommittedWarningMessage('Unable to show commit file details');

					return;
				}

				args.sha = blame.commit.sha;

				args.commit = blame.commit;
			} catch (ex) {
				Logger.error(ex, 'ShowQuickCommitFileDetailsCommand', `getBlameForLine(${blameline})`);
				window.showErrorMessage('Unable to show commit file details. See output channel for more details');

				return;
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
						Messages.showCommitNotFoundWarningMessage('Unable to show commit file details');

						return;
					}
				}
			}

			if (args.commit === undefined) {
				Messages.showCommitNotFoundWarningMessage('Unable to show commit file details');

				return;
			}

			// const shortSha = GitRevision.shorten(args.sha);

			const fileName = args.commit.fileName;
			if (args.commit instanceof GitBlameCommit) {
				args.commit = (await Container.git.getCommit(args.commit.repoPath, args.commit.ref))!;
			}

			void (await executeGitCommand({
				command: 'show',
				state: {
					repo: args.commit.repoPath,
					reference: args.commit as GitLogCommit,
					fileName: fileName,
				},
			}));

			// if (args.goBackCommand === undefined) {
			// 	const commandArgs: ShowQuickCommitCommandArgs = {
			// 		commit: args.commit,
			// 		sha: args.sha,
			// 	};

			// 	// Create a command to get back to the commit details
			// 	args.goBackCommand = new CommandQuickPickItem(
			// 		{
			// 			label: `go back ${GlyphChars.ArrowBack}`,
			// 			description: `to details of ${GlyphChars.Space}$(git-commit) ${shortSha}`,
			// 		},
			// 		Commands.ShowQuickCommit,
			// 		[args.commit.toGitUri(), commandArgs],
			// 	);
			// }

			// // Create a command to get back to where we are right now
			// const currentCommand = new CommandQuickPickItem(
			// 	{
			// 		label: `go back ${GlyphChars.ArrowBack}`,
			// 		description: `to details of ${args.commit.getFormattedPath()} from ${
			// 			GlyphChars.Space
			// 		}$(git-commit) ${shortSha}`,
			// 	},
			// 	Commands.ShowQuickCommitFile,
			// 	[args.commit.toGitUri(), args],
			// );

			// const pick = await CommitFileQuickPick.show(args.commit as GitLogCommit, uri, {
			// 	goBackCommand: args.goBackCommand,
			// 	currentCommand: currentCommand,
			// 	fileLog: args.fileLog,
			// });
			// if (pick === undefined) return undefined;

			// if (pick instanceof CommandQuickPickItem) return pick.execute();

			// return undefined;
		} catch (ex) {
			Logger.error(ex, 'ShowQuickCommitFileDetailsCommand');
			Messages.showGenericErrorMessage('Unable to show commit file details');
		}
	}
}
