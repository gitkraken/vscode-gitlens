import type { TextEditor, Uri } from 'vscode';
import { env } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { shortenRevision } from '../git/models/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { first } from '../system/iterable';
import { Logger } from '../system/logger';
import { command } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import type { CommandContext } from './base';
import {
	ActiveEditorCommand,
	getCommandUri,
	isCommandContextViewNodeHasBranch,
	isCommandContextViewNodeHasCommit,
	isCommandContextViewNodeHasTag,
} from './base';

export interface CopyShaToClipboardCommandArgs {
	sha?: string;
}

@command()
export class CopyShaToClipboardCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.CopyShaToClipboard);
	}

	protected override preExecute(context: CommandContext, args?: CopyShaToClipboardCommandArgs) {
		if (isCommandContextViewNodeHasCommit(context)) {
			args = { ...args };
			args.sha = context.node.commit.sha;
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

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyShaToClipboardCommandArgs) {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			if (!args.sha) {
				// If we don't have an editor then get the sha of the last commit to the branch
				if (uri == null) {
					const repoPath = this.container.git.getBestRepository(editor)?.path;
					if (!repoPath) return;

					const log = await this.container.git.getLog(repoPath, { limit: 1 });
					if (log == null) return;

					args.sha = first(log.commits.values())?.sha;
					if (args.sha == null) return;
				} else if (args.sha == null) {
					const blameline = editor?.selection.active.line ?? 0;
					if (blameline < 0) return;

					try {
						const gitUri = await GitUri.fromUri(uri);
						const blame = await this.container.git.getBlameForLine(gitUri, blameline, editor?.document);
						if (blame == null) return;

						args.sha = blame.commit.sha;
					} catch (ex) {
						Logger.error(ex, 'CopyShaToClipboardCommand', `getBlameForLine(${blameline})`);
						void showGenericErrorMessage('Unable to copy commit SHA');

						return;
					}
				}
			}

			await env.clipboard.writeText(
				configuration.get('advanced.abbreviateShaOnCopy') ? shortenRevision(args.sha) : args.sha,
			);
		} catch (ex) {
			Logger.error(ex, 'CopyShaToClipboardCommand');
			void showGenericErrorMessage('Unable to copy commit SHA');
		}
	}
}
