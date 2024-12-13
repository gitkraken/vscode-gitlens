import type { TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { reveal } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import type { GitLog } from '../git/models/log';
import {
	showCommitNotFoundWarningMessage,
	showFileNotUnderSourceControlWarningMessage,
	showGenericErrorMessage,
	showLineUncommittedWarningMessage,
} from '../messages';
import { createMarkdownCommandLink } from '../system/commands';
import { Logger } from '../system/logger';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import { ActiveEditorCachedCommand, getCommandUri, isCommandContextViewNodeHasCommit } from './base';

export interface ShowQuickCommitCommandArgs {
	repoPath?: string;
	sha?: string;
	commit?: GitCommit | GitStashCommit;
	repoLog?: GitLog;
	revealInView?: boolean;
}

@command()
export class ShowQuickCommitCommand extends ActiveEditorCachedCommand {
	static createMarkdownCommandLink(sha: string, repoPath?: string): string;
	static createMarkdownCommandLink(args: ShowQuickCommitCommandArgs): string;
	static createMarkdownCommandLink(argsOrSha: ShowQuickCommitCommandArgs | string, repoPath?: string): string {
		const args = typeof argsOrSha === 'string' ? { sha: argsOrSha, repoPath: repoPath } : argsOrSha;
		return createMarkdownCommandLink<ShowQuickCommitCommandArgs>(GlCommand.ShowQuickCommit, args);
	}

	constructor(private readonly container: Container) {
		super([GlCommand.RevealCommitInView, GlCommand.ShowQuickCommit]);
	}

	protected override preExecute(context: CommandContext, args?: ShowQuickCommitCommandArgs) {
		if (context.command === GlCommand.RevealCommitInView) {
			args = { ...args };
			args.revealInView = true;
		}

		if (context.type === 'viewItem') {
			args = { ...args };
			args.sha = context.node.uri.sha;

			if (isCommandContextViewNodeHasCommit(context)) {
				args.commit = context.node.commit;
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickCommitCommandArgs) {
		let gitUri;
		let repoPath;
		if (args?.commit == null) {
			if (args?.repoPath != null && args.sha != null) {
				repoPath = args.repoPath;
				gitUri = GitUri.fromRepoPath(repoPath);
			} else {
				uri = getCommandUri(uri, editor);
				if (uri == null) return;

				gitUri = await GitUri.fromUri(uri);
				repoPath = gitUri.repoPath!;
			}
		} else {
			if (args.sha == null) {
				args.sha = args.commit.sha;
			}

			gitUri = args.commit.getGitUri();
			repoPath = args.commit.repoPath;

			if (uri == null) {
				uri = args.commit.file?.uri;
			}
		}

		args = { ...args };
		if (args.sha == null) {
			if (editor == null) return;

			const blameline = editor.selection.active.line;
			if (blameline < 0) return;

			try {
				const blame = await this.container.git.getBlameForLine(gitUri, blameline);
				if (blame == null) {
					void showFileNotUnderSourceControlWarningMessage('Unable to show commit');

					return;
				}

				// Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
				if (blame.commit.isUncommitted) {
					void showLineUncommittedWarningMessage('Unable to show commit');

					return;
				}

				args.sha = blame.commit.sha;
				repoPath = blame.commit.repoPath;

				args.commit = blame.commit;
			} catch (ex) {
				Logger.error(ex, 'ShowQuickCommitCommand', `getBlameForLine(${blameline})`);
				void showGenericErrorMessage('Unable to show commit');

				return;
			}
		}

		try {
			if (args.commit == null || args.commit.file != null) {
				if (args.repoLog != null) {
					args.commit = args.repoLog.commits.get(args.sha);
					// If we can't find the commit, kill the repoLog
					if (args.commit == null) {
						args.repoLog = undefined;
					}
				}

				if (args.repoLog == null) {
					args.commit = await this.container.git.getCommit(repoPath, args.sha);
				}
			}

			if (args.commit == null) {
				void showCommitNotFoundWarningMessage('Unable to show commit');

				return;
			}

			if (args.revealInView) {
				void (await reveal(args.commit, {
					select: true,
					focus: true,
					expand: true,
				}));

				return;
			}

			await executeGitCommand({
				command: 'show',
				state: {
					repo: repoPath,
					reference: args.commit,
				},
			});
		} catch (ex) {
			Logger.error(ex, 'ShowQuickCommitCommand');
			void showGenericErrorMessage('Unable to show commit');
		}
	}
}
