import type { TextEditor, Uri } from 'vscode';
import { env } from 'vscode';
import type { Container } from '../container';
import { copyMessageToClipboard } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/-webview/command';
import { first } from '../system/iterable';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import {
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasTag,
} from './commandContext.utils';

export interface CopyMessageToClipboardCommandArgs {
	message?: string;
	sha?: string;
	repoPath?: string;
}

@command()
export class CopyMessageToClipboardCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.copyMessageToClipboard');
	}

	protected override async preExecute(
		context: CommandContext,
		args?: CopyMessageToClipboardCommandArgs,
	): Promise<void> {
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

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyMessageToClipboardCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			if (!args.message) {
				if (args.repoPath != null && args.sha != null) {
					await copyMessageToClipboard({ ref: args.sha, repoPath: args.repoPath });
					return;
				}

				// If we don't have an editor then get the message of the last commit to the branch
				if (uri == null) {
					const repo = this.container.git.getBestRepository(editor);
					if (repo == null) return;

					const log = await repo.git.commits.getLog(undefined, { limit: 1 });
					if (log == null) return;

					const commit = first(log.commits.values());
					if (commit?.message == null) return;

					args.message = commit.message;
				} else if (args.message == null) {
					const gitUri = await GitUri.fromUri(uri);
					const repoPath = gitUri.repoPath;
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
