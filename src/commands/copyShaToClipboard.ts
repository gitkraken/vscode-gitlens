'use strict';
import { env, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Iterables } from '../system';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	isCommandViewContextWithCommit,
} from './common';

export interface CopyShaToClipboardCommandArgs {
	sha?: string;
}

@command()
export class CopyShaToClipboardCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.CopyShaToClipboard);
	}

	protected preExecute(context: CommandContext, args?: CopyShaToClipboardCommandArgs) {
		if (isCommandViewContextWithCommit(context)) {
			args = { ...args };
			args.sha = context.node.commit.sha;
			return this.execute(context.editor, context.node.commit.uri, args);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyShaToClipboardCommandArgs) {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			// If we don't have an editor then get the sha of the last commit to the branch
			if (uri == null) {
				const repoPath = await Container.git.getActiveRepoPath(editor);
				if (!repoPath) return;

				const log = await Container.git.getLog(repoPath, { limit: 1 });
				if (!log) return;

				args.sha = Iterables.first(log.commits.values()).sha;
			} else if (args.sha == null) {
				const blameline = editor?.selection.active.line ?? 0;
				if (blameline < 0) return;

				try {
					const gitUri = await GitUri.fromUri(uri);
					const blame = editor?.document.isDirty
						? await Container.git.getBlameForLineContents(gitUri, blameline, editor.document.getText())
						: await Container.git.getBlameForLine(gitUri, blameline);
					if (blame == null) return;

					args.sha = blame.commit.sha;
				} catch (ex) {
					Logger.error(ex, 'CopyShaToClipboardCommand', `getBlameForLine(${blameline})`);
					void Messages.showGenericErrorMessage('Unable to copy commit id');

					return;
				}
			}

			void (await env.clipboard.writeText(args.sha));
		} catch (ex) {
			const msg: string = ex?.message ?? '';
			if (msg.includes("Couldn't find the required `xsel` binary")) {
				void window.showErrorMessage(
					'Unable to copy commit id, xsel is not installed. Please install it via your package manager, e.g. `sudo apt install xsel`',
				);

				return;
			}

			Logger.error(ex, 'CopyShaToClipboardCommand');
			void Messages.showGenericErrorMessage('Unable to copy commit id');
		}
	}
}
