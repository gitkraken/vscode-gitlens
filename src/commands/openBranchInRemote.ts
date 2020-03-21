'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri, RemoteResourceType } from '../git/gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, ReferencesQuickPick, ReferencesQuickPickIncludes } from '../quickpicks';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	getRepoPathOrActiveOrPrompt,
	isCommandViewContextWithBranch,
} from './common';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenBranchInRemoteCommandArgs {
	branch?: string;
	remote?: string;
}

@command()
export class OpenBranchInRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenBranchInRemote);
	}

	protected preExecute(context: CommandContext, args?: OpenBranchInRemoteCommandArgs) {
		if (isCommandViewContextWithBranch(context)) {
			args = { ...args };
			args.branch = context.node.branch.name;
			args.remote = context.node.branch.getRemoteName();
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenBranchInRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri && (await GitUri.fromUri(uri));

		const repoPath = await getRepoPathOrActiveOrPrompt(
			gitUri,
			editor,
			`Open branch on remote for which repository${GlyphChars.Ellipsis}`,
		);
		if (!repoPath) return undefined;

		args = { ...args };

		try {
			if (args.branch === undefined) {
				const pick = await new ReferencesQuickPick(repoPath).show(
					`Open which branch on remote${GlyphChars.Ellipsis}`,
					{
						autoPick: true,
						checkmarks: false,
						filterBranches: b => b.tracking !== undefined,
						include: ReferencesQuickPickIncludes.Branches,
					},
				);
				if (pick === undefined || pick instanceof CommandQuickPickItem) return undefined;

				args.branch = pick.ref;
			}

			const remotes = await Container.git.getRemotes(repoPath);

			const commandArgs: OpenInRemoteCommandArgs = {
				resource: {
					type: RemoteResourceType.Branch,
					branch: args.branch || 'HEAD',
				},
				remote: args.remote,
				remotes: remotes,
			};
			return commands.executeCommand(Commands.OpenInRemote, uri, commandArgs);
		} catch (ex) {
			Logger.error(ex, 'OpenBranchInRemoteCommandArgs');
			return window.showErrorMessage(
				'Unable to open branch on remote provider. See output channel for more details',
			);
		}
	}
}
