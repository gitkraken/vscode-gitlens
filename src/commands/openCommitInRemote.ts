'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { GitUri, RemoteResourceType } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	isCommandViewContextWithCommit
} from './common';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenCommitInRemoteCommandArgs {
	sha?: string;
}

@command()
export class OpenCommitInRemoteCommand extends ActiveEditorCommand {
	static getMarkdownCommandArgs(sha: string): string;
	static getMarkdownCommandArgs(args: OpenCommitInRemoteCommandArgs): string;
	static getMarkdownCommandArgs(argsOrSha: OpenCommitInRemoteCommandArgs | string): string {
		const args: OpenCommitInRemoteCommandArgs = typeof argsOrSha === 'string' ? { sha: argsOrSha } : argsOrSha;
		return super.getMarkdownCommandArgsCore<OpenCommitInRemoteCommandArgs>(Commands.OpenCommitInRemote, args);
	}

	constructor() {
		super(Commands.OpenCommitInRemote);
	}

	protected preExecute(context: CommandContext, args: OpenCommitInRemoteCommandArgs = {}) {
		if (isCommandViewContextWithCommit(context)) {
			args = { ...args };
			args.sha = context.node.commit.sha;
			return this.execute(context.editor, context.node.commit.uri, args);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args: OpenCommitInRemoteCommandArgs = {}) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;
		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) return undefined;

		try {
			if (args.sha === undefined) {
				const blameline = editor == null ? 0 : editor.selection.active.line;
				if (blameline < 0) return undefined;

				const blame =
					editor && editor.document && editor.document.isDirty
						? await Container.git.getBlameForLineContents(gitUri, blameline, editor.document.getText())
						: await Container.git.getBlameForLine(gitUri, blameline);
				if (blame === undefined) {
					return Messages.showFileNotUnderSourceControlWarningMessage(
						'Unable to open commit on remote provider'
					);
				}

				let commit = blame.commit;
				// If the line is uncommitted, find the previous commit
				if (commit.isUncommitted) {
					commit = commit.with({
						sha: commit.previousSha,
						fileName: commit.previousFileName,
						previousSha: null,
						previousFileName: null
					});
				}

				args.sha = commit.sha;
			}

			const remotes = await Container.git.getRemotes(gitUri.repoPath);

			const commandArgs: OpenInRemoteCommandArgs = {
				resource: {
					type: RemoteResourceType.Commit,
					sha: args.sha
				},
				remotes: remotes
			};
			return commands.executeCommand(Commands.OpenInRemote, uri, commandArgs);
		} catch (ex) {
			Logger.error(ex, 'OpenCommitInRemoteCommand');
			return window.showErrorMessage(
				'Unable to open commit on remote provider. See output channel for more details'
			);
		}
	}
}
