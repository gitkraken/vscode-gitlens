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

export interface OpenBranchesInRemoteCommandArgs {
	remote?: string;
}

@command()
export class OpenBranchesInRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenBranchesInRemote);
	}

	protected preExecute(context: CommandContext, args: OpenBranchesInRemoteCommandArgs = {}) {
		if (isCommandViewContextWithRemote(context)) {
			args = { ...args };
			args.remote = context.node.remote.name;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args: OpenBranchesInRemoteCommandArgs = {}) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri && (await GitUri.fromUri(uri));

		const repoPath = await getRepoPathOrActiveOrPrompt(
			gitUri,
			editor,
			`Open branches on remote for which repository${GlyphChars.Ellipsis}`
		);
		if (!repoPath) return undefined;

		try {
			const remotes = await Container.git.getRemotes(repoPath);

			const commandArgs: OpenInRemoteCommandArgs = {
				resource: {
					type: RemoteResourceType.Branches
				},
				remote: args.remote,
				remotes: remotes
			};
			return commands.executeCommand(Commands.OpenInRemote, uri, commandArgs);
		} catch (ex) {
			Logger.error(ex, 'OpenBranchesInRemoteCommand');
			return window.showErrorMessage(
				'Unable to open branches on remote provider. See output channel for more details'
			);
		}
	}
}
