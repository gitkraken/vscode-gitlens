import { TextEditor, Uri, window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { GitCommit, GitLog, GitStashCommit } from '../git/models';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { command } from '../system/command';
import { ActiveEditorCachedCommand, CommandContext, getCommandUri, isCommandContextViewNodeHasCommit } from './base';
import { executeGitCommand } from './gitCommands.actions';

export interface ShowQuickCommitFileCommandArgs {
	sha?: string;
	commit?: GitCommit | GitStashCommit;
	fileLog?: GitLog;
	revisionUri?: string;
}

@command()
export class ShowQuickCommitFileCommand extends ActiveEditorCachedCommand {
	static getMarkdownCommandArgs(args: ShowQuickCommitFileCommandArgs): string {
		return super.getMarkdownCommandArgsCore<ShowQuickCommitFileCommandArgs>(Commands.ShowQuickCommitFile, args);
	}

	constructor(private readonly container: Container) {
		super([
			Commands.ShowQuickCommitFile,
			Commands.ShowQuickCommitRevision,
			Commands.ShowQuickCommitRevisionInDiffLeft,
			Commands.ShowQuickCommitRevisionInDiffRight,
		]);
	}

	protected override async preExecute(context: CommandContext, args?: ShowQuickCommitFileCommandArgs) {
		if (context.editor != null && context.command.startsWith(Commands.ShowQuickCommitRevision)) {
			args = { ...args };

			const gitUri = await GitUri.fromUri(context.editor.document.uri);
			args.sha = gitUri.sha;
		}

		if (context.type === 'viewItem') {
			args = { ...args };
			args.sha = context.node.uri.sha;

			if (isCommandContextViewNodeHasCommit(context)) {
				args.commit = context.node.commit as any;
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
			gitUri = GitUri.fromRevisionUri(Uri.parse(args.revisionUri, true));
			args.sha = gitUri.sha;
		} else {
			gitUri = await GitUri.fromUri(uri);
		}

		if (args.sha === undefined) {
			if (editor == null) return;

			const blameline = editor.selection.active.line;
			if (blameline < 0) return;

			try {
				const blame = await this.container.git.getBlameForLine(gitUri, blameline);
				if (blame == null) {
					void Messages.showFileNotUnderSourceControlWarningMessage('Unable to show commit file details');

					return;
				}

				// Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
				if (blame.commit.isUncommitted) {
					void Messages.showLineUncommittedWarningMessage('Unable to show commit file details');

					return;
				}

				args.sha = blame.commit.sha;

				args.commit = blame.commit;
			} catch (ex) {
				Logger.error(ex, 'ShowQuickCommitFileDetailsCommand', `getBlameForLine(${blameline})`);
				void window.showErrorMessage('Unable to show commit file details. See output channel for more details');

				return;
			}
		}

		try {
			if (args.commit == null /*|| args.commit.file != null*/) {
				if (args.fileLog != null) {
					args.commit = args.fileLog.commits.get(args.sha);
					// If we can't find the commit, kill the fileLog
					if (args.commit == null) {
						args.fileLog = undefined;
					}
				}

				if (args.fileLog == null) {
					const repoPath = args.commit?.repoPath ?? gitUri.repoPath;
					args.commit = await this.container.git.getCommitForFile(repoPath, gitUri, {
						ref: args.sha,
					});
					if (args.commit == null) {
						void Messages.showCommitNotFoundWarningMessage('Unable to show commit file details');

						return;
					}
				}
			}

			if (args.commit == null) {
				void Messages.showCommitNotFoundWarningMessage('Unable to show commit file details');

				return;
			}

			const path = args.commit?.file?.path ?? gitUri.fsPath;
			if (GitCommit.is(args.commit)) {
				if (args.commit.files == null) {
					await args.commit.ensureFullDetails();
				}
			}

			// const shortSha = GitRevision.shorten(args.sha);

			// if (args.commit instanceof GitBlameCommit) {
			// 	args.commit = (await this.container.git.getCommit(args.commit.repoPath, args.commit.ref))!;
			// }

			void (await executeGitCommand({
				command: 'show',
				state: {
					repo: args.commit.repoPath,
					reference: args.commit,
					fileName: path,
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

			// const pick = await CommitFileQuickPick.show(args.commit as GitCommit, uri, {
			// 	goBackCommand: args.goBackCommand,
			// 	currentCommand: currentCommand,
			// 	fileLog: args.fileLog,
			// });
			// if (pick === undefined) return undefined;

			// if (pick instanceof CommandQuickPickItem) return pick.execute();

			// return undefined;
		} catch (ex) {
			Logger.error(ex, 'ShowQuickCommitFileDetailsCommand');
			void Messages.showGenericErrorMessage('Unable to show commit file details');
		}
	}
}
