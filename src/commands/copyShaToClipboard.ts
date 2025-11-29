import type { TextEditor, Uri } from 'vscode';
import { env } from 'vscode';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { shortenRevision } from '../git/utils/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { createMarkdownCommandLink } from '../system/commands';
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

export interface CopyShaToClipboardCommandArgs {
	sha?: string;
	source?: Source;
}

@command()
export class CopyShaToClipboardCommand extends ActiveEditorCommand {
	static createMarkdownCommandLink(sha: string, source: Source): string;
	static createMarkdownCommandLink(args: CopyShaToClipboardCommandArgs): string;
	static createMarkdownCommandLink(argsOrSha: CopyShaToClipboardCommandArgs | string, source?: Source): string {
		const args = typeof argsOrSha === 'string' ? { sha: argsOrSha, source: source } : argsOrSha;
		return createMarkdownCommandLink<CopyShaToClipboardCommandArgs>('gitlens.copyShaToClipboard', args);
	}

	constructor(private readonly container: Container) {
		super('gitlens.copyShaToClipboard');
	}

	protected override preExecute(context: CommandContext, args?: CopyShaToClipboardCommandArgs): Promise<void> {
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

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyShaToClipboardCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			if (!args.sha) {
				// If we don't have an editor then get the sha of the last commit to the branch
				if (uri == null) {
					const repo = this.container.git.getBestRepository(editor);
					if (repo == null) return;

					const log = await repo.git.commits.getLog(undefined, { limit: 1 });
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
