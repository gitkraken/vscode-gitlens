import type { TextEditor } from 'vscode';
import { Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { GitUri } from '../git/gitUri';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import { isCommit } from '../git/models/commit';
import type { GitLog } from '../git/models/log';
import {
	showCommitNotFoundWarningMessage,
	showFileNotUnderSourceControlWarningMessage,
	showGenericErrorMessage,
	showLineUncommittedWarningMessage,
} from '../messages';
import { command, executeCommand, executeCoreCommand } from '../system/command';
import { Logger } from '../system/logger';
import type { CommandContext } from './base';
import { ActiveEditorCachedCommand, getCommandUri, isCommandContextViewNodeHasCommit } from './base';
import type { ShowCommitsInViewCommandArgs } from './showCommitsInView';

export interface ShowQuickCommitFileCommandArgs {
	commit?: GitCommit | GitStashCommit;
	line?: number;
	fileLog?: GitLog;
	revisionUri?: string;
	sha?: string;

	inView?: boolean;
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
			Commands.ShowLineCommitInView,
		]);
	}

	protected override async preExecute(context: CommandContext, args?: ShowQuickCommitFileCommandArgs) {
		if (context.type === 'editorLine') {
			args = { ...args, line: context.line };
		}

		if (context.command === Commands.ShowLineCommitInView) {
			args = { ...args, inView: true };
		}

		if (context.editor != null && context.command.startsWith(Commands.ShowQuickCommitRevision)) {
			const gitUri = await GitUri.fromUri(context.editor.document.uri);

			args = { ...args, sha: gitUri.sha };
		}

		if (context.type === 'viewItem') {
			args = { ...args, sha: context.node.uri.sha };

			if (isCommandContextViewNodeHasCommit(context)) {
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
		if (args.revisionUri != null) {
			gitUri = GitUri.fromRevisionUri(Uri.parse(args.revisionUri, true));
			args.sha = gitUri.sha;
		} else {
			gitUri = await GitUri.fromUri(uri);
		}

		if (args.sha == null) {
			const blameLine = args.line ?? editor?.selection.active.line;
			if (blameLine == null) return;

			try {
				const blame = await this.container.git.getBlameForLine(gitUri, blameLine);
				if (blame == null) {
					void showFileNotUnderSourceControlWarningMessage('Unable to show commit file details');

					return;
				}

				// Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
				if (blame.commit.isUncommitted) {
					void showLineUncommittedWarningMessage('Unable to show commit file details');

					return;
				}

				args.sha = blame.commit.sha;

				args.commit = blame.commit;
			} catch (ex) {
				Logger.error(ex, 'ShowQuickCommitFileDetailsCommand', `getBlameForLine(${blameLine})`);
				void showGenericErrorMessage('Unable to show commit file details');

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
						void showCommitNotFoundWarningMessage('Unable to show commit file details');

						return;
					}
				}
			}

			if (args.commit == null) {
				void showCommitNotFoundWarningMessage('Unable to show commit file details');

				return;
			}

			const path = args.commit?.file?.path ?? gitUri.fsPath;
			if (isCommit(args.commit)) {
				if (args.commit.files == null) {
					await args.commit.ensureFullDetails();
				}
			}

			if (args.inView) {
				await executeCommand<ShowCommitsInViewCommandArgs>(Commands.ShowCommitsInView, {
					refs: [args.commit.sha],
					repoPath: args.commit.repoPath,
				});
			} else {
				await executeCoreCommand('workbench.action.focusActiveEditorGroup');
				await executeGitCommand({
					command: 'show',
					state: {
						repo: args.commit.repoPath,
						reference: args.commit,
						fileName: path,
					},
				});
			}
		} catch (ex) {
			Logger.error(ex, 'ShowQuickCommitFileDetailsCommand');
			void showGenericErrorMessage('Unable to show commit file details');
		}
	}
}
