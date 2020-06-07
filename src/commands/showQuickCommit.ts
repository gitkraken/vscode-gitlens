'use strict';
import { TextEditor, Uri } from 'vscode';
import {
	ActiveEditorCachedCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	isCommandViewContextWithCommit,
} from './common';
import { Container } from '../container';
import { GitCommit, GitLog, GitLogCommit } from '../git/git';
import { executeGitCommand } from './gitCommands';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface ShowQuickCommitCommandArgs {
	sha?: string;
	commit?: GitCommit | GitLogCommit;
	repoLog?: GitLog;
	revealInView?: boolean;
}

@command()
export class ShowQuickCommitCommand extends ActiveEditorCachedCommand {
	static getMarkdownCommandArgs(sha: string): string;
	static getMarkdownCommandArgs(args: ShowQuickCommitCommandArgs): string;
	static getMarkdownCommandArgs(argsOrSha: ShowQuickCommitCommandArgs | string): string {
		const args = typeof argsOrSha === 'string' ? { sha: argsOrSha } : argsOrSha;
		return super.getMarkdownCommandArgsCore<ShowQuickCommitCommandArgs>(Commands.ShowQuickCommit, args);
	}

	constructor() {
		super([Commands.RevealCommitInView, Commands.ShowQuickCommit]);
	}

	protected preExecute(context: CommandContext, args?: ShowQuickCommitCommandArgs) {
		if (context.command === Commands.RevealCommitInView) {
			args = { ...args };
			args.revealInView = true;
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

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickCommitCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		let repoPath = gitUri.repoPath;

		args = { ...args };
		if (args.sha == null) {
			if (editor == null) return;

			const blameline = editor.selection.active.line;
			if (blameline < 0) return;

			try {
				const blame = await Container.git.getBlameForLine(gitUri, blameline);
				if (blame == null) {
					void Messages.showFileNotUnderSourceControlWarningMessage('Unable to show commit');

					return;
				}

				// Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
				if (blame.commit.isUncommitted) {
					void Messages.showLineUncommittedWarningMessage('Unable to show commit');

					return;
				}

				args.sha = blame.commit.sha;
				repoPath = blame.commit.repoPath;

				args.commit = blame.commit;
			} catch (ex) {
				Logger.error(ex, 'ShowQuickCommitCommand', `getBlameForLine(${blameline})`);
				void Messages.showGenericErrorMessage('Unable to show commit');

				return;
			}
		}

		try {
			if (args.commit == null || args.commit.isFile) {
				if (args.repoLog != null) {
					args.commit = args.repoLog.commits.get(args.sha);
					// If we can't find the commit, kill the repoLog
					if (args.commit === undefined) {
						args.repoLog = undefined;
					}
				}

				if (args.repoLog === undefined) {
					const log = await Container.git.getLog(repoPath!, { limit: 2, ref: args.sha });
					if (log === undefined) {
						void Messages.showCommitNotFoundWarningMessage('Unable to show commit');

						return;
					}

					args.commit = log.commits.get(args.sha);
				}
			}

			if (args.commit === undefined) {
				void Messages.showCommitNotFoundWarningMessage('Unable to show commit');

				return;
			}

			if (args.revealInView) {
				void (await Container.repositoriesView.revealCommit(args.commit, {
					select: true,
					focus: true,
					expand: true,
				}));

				return;
			}

			void (await executeGitCommand({
				command: 'show',
				state: {
					repo: repoPath!,
					reference: args.commit as GitLogCommit,
				},
			}));
		} catch (ex) {
			Logger.error(ex, 'ShowQuickCommitCommand');
			void Messages.showGenericErrorMessage('Unable to show commit');
		}
	}
}
