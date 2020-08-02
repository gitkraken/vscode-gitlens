'use strict';
import { TextEditor, Uri, window } from 'vscode';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	executeCommand,
	getCommandUri,
	isCommandViewContextWithCommit,
} from './common';
import { Container } from '../container';
import { RemoteResourceType } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenCommitOnRemoteCommandArgs {
	clipboard?: boolean;
	sha?: string;
}

@command()
export class OpenCommitOnRemoteCommand extends ActiveEditorCommand {
	static getMarkdownCommandArgs(sha: string): string;
	static getMarkdownCommandArgs(args: OpenCommitOnRemoteCommandArgs): string;
	static getMarkdownCommandArgs(argsOrSha: OpenCommitOnRemoteCommandArgs | string): string {
		const args: OpenCommitOnRemoteCommandArgs = typeof argsOrSha === 'string' ? { sha: argsOrSha } : argsOrSha;
		return super.getMarkdownCommandArgsCore<OpenCommitOnRemoteCommandArgs>(Commands.OpenCommitInRemote, args);
	}

	constructor() {
		super(Commands.OpenCommitInRemote);
	}

	protected preExecute(context: CommandContext, args?: OpenCommitOnRemoteCommandArgs) {
		if (isCommandViewContextWithCommit(context)) {
			args = { ...args };
			args.sha = context.node.commit.sha;
			return this.execute(context.editor, context.node.commit.uri, args);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenCommitOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) return;

		args = { ...args };

		try {
			if (args.sha == null) {
				const blameline = editor == null ? 0 : editor.selection.active.line;
				if (blameline < 0) return;

				const blame = editor?.document.isDirty
					? await Container.git.getBlameForLineContents(gitUri, blameline, editor.document.getText())
					: await Container.git.getBlameForLine(gitUri, blameline);
				if (blame == null) {
					void Messages.showFileNotUnderSourceControlWarningMessage(
						'Unable to open commit on remote provider',
					);

					return;
				}

				let commit = blame.commit;
				// If the line is uncommitted, find the previous commit
				if (commit.isUncommitted) {
					commit = commit.with({
						sha: commit.previousSha,
						fileName: commit.previousFileName,
						previousSha: null,
						previousFileName: null,
					});
				}

				args.sha = commit.sha;
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenInRemote, {
				resource: {
					type: RemoteResourceType.Commit,
					sha: args.sha,
				},
				repoPath: gitUri.repoPath,
				clipboard: args.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenCommitOnRemoteCommand');
			void window.showErrorMessage(
				'Unable to open commit on remote provider. See output channel for more details',
			);
		}
	}
}
