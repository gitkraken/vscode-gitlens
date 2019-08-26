'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri, RemoteResourceType } from '../git/gitService';
import { Logger } from '../logger';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	getRepoPathOrActiveOrPrompt,
	isCommandViewContextWithRemote
} from './common';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenRepoInRemoteCommandArgs {
	remote?: string;
}

@command()
export class OpenRepoInRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenRepoInRemote);
	}

	protected preExecute(context: CommandContext, args: OpenRepoInRemoteCommandArgs = {}) {
		if (isCommandViewContextWithRemote(context)) {
			args = { ...args };
			args.remote = context.node.remote.name;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args: OpenRepoInRemoteCommandArgs = {}) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri && (await GitUri.fromUri(uri));

		const repoPath = await getRepoPathOrActiveOrPrompt(
			gitUri,
			editor,
			`Open which repository on remote${GlyphChars.Ellipsis}`
		);
		if (!repoPath) return undefined;

		try {
			const remotes = await Container.git.getRemotes(repoPath);

			const commandArgs: OpenInRemoteCommandArgs = {
				resource: {
					type: RemoteResourceType.Repo
				},
				remote: args.remote,
				remotes: remotes
			};
			return commands.executeCommand(Commands.OpenInRemote, uri, commandArgs);
		} catch (ex) {
			Logger.error(ex, 'OpenRepoInRemoteCommand');
			return window.showErrorMessage(
				'Unable to open repository on remote provider. See output channel for more details'
			);
		}
	}
}
