import type { TextEditor, Uri } from 'vscode';
import { env } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { copyMessageToClipboard } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { showGenericErrorMessage } from '../messages';
import { first } from '../system/iterable';
import { Logger } from '../system/logger';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	getCommandUri,
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasTag,
} from './base';

export interface CopyMessageToClipboardCommandArgs {
	message?: string;
	sha?: string;
	repoPath?: string;
}

@command()
export class CopyMessageToClipboardCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.CopyMessageToClipboard);
	}

	protected override async preExecute(context: CommandContext, args?: CopyMessageToClipboardCommandArgs) {
		if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args };
			args.sha = context.node.commit.sha;
			if (context.node.commit.message != null) {
				await context.node.commit.ensureFullDetails();
			}
			args.message = context.node.commit.message;
			return this.execute(
				context.editor,
				context.node.commit.file?.uri ?? context.node.commit.getRepository()?.uri,
				args,
			);
		} else if (isCommandContextViewNodeHasBranch(context)) {
			args = { ...args };
			args.sha = context.node.branch.sha;
			return this.execute(context.editor, context.node.uri, args);
		} else if (isCommandContextViewNodeHasTag(context)) {
			args = { ...args };
			args.sha = context.node.tag.sha;
			return this.execute(context.editor, context.node.uri, args);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyMessageToClipboardCommandArgs) {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			if (!args.message) {
				if (args.repoPath != null && args.sha != null) {
					await copyMessageToClipboard({ ref: args.sha, repoPath: args.repoPath });
					return;
				}

				let repoPath;

				// If we don't have an editor then get the message of the last commit to the branch
				if (uri == null) {
					repoPath = this.container.git.getBestRepository(editor)?.path;
					if (!repoPath) return;

					const log = await this.container.git.getLog(repoPath, { limit: 1 });
					if (log == null) return;

					const commit = first(log.commits.values());
					if (commit?.message == null) return;

					args.message = commit.message;
				} else if (args.message == null) {
					const gitUri = await GitUri.fromUri(uri);
					repoPath = gitUri.repoPath;
					if (!repoPath) return;

					if (args.sha == null) {
						const blameline = editor?.selection.active.line ?? 0;
						if (blameline < 0) return;

						try {
							const blame = await this.container.git.getBlameForLine(gitUri, blameline, editor?.document);
							if (blame == null || blame.commit.isUncommitted) return;

							await copyMessageToClipboard(blame.commit);
							return;
						} catch (ex) {
							Logger.error(ex, 'CopyMessageToClipboardCommand', `getBlameForLine(${blameline})`);
							void showGenericErrorMessage('Unable to copy message');

							return;
						}
					} else {
						await copyMessageToClipboard({ ref: args.sha, repoPath: repoPath });
						return;
					}
				}
			}

			await env.clipboard.writeText(args.message);
		} catch (ex) {
			Logger.error(ex, 'CopyMessageToClipboardCommand');
			void showGenericErrorMessage('Unable to copy message');
		}
	}
}
