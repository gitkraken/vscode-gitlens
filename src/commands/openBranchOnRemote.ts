'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { RemoteResourceType } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { CommandQuickPickItem, ReferencePicker, ReferencesQuickPickIncludes } from '../quickpicks';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	executeCommand,
	getCommandUri,
	getRepoPathOrActiveOrPrompt,
	isCommandViewContextWithBranch,
} from './common';
import { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenBranchOnRemoteCommandArgs {
	branch?: string;
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenBranchOnRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.OpenBranchInRemote, Commands.CopyRemoteBranchUrl]);
	}

	protected preExecute(context: CommandContext, args?: OpenBranchOnRemoteCommandArgs) {
		if (isCommandViewContextWithBranch(context)) {
			args = {
				...args,
				branch: context.node.branch.name,
				remote: context.node.branch.getRemoteName(),
			};
		}

		if (context.command === Commands.CopyRemoteBranchUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenBranchOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = await getRepoPathOrActiveOrPrompt(
			gitUri,
			editor,
			args?.clipboard ? 'Copy Remote Branch Url' : 'Open Branch On Remote',
		);
		if (!repoPath) return;

		args = { ...args };

		try {
			if (args.branch == null) {
				const pick = await ReferencePicker.show(
					repoPath,
					args.clipboard ? 'Copy Remote Branch Url' : 'Open Branch On Remote',
					args.clipboard ? 'Choose a branch to copy the url from' : 'Choose a branch to open',
					{
						autoPick: true,
						// checkmarks: false,
						filterBranches: b => b.tracking != null,
						include: ReferencesQuickPickIncludes.Branches,
					},
				);
				if (pick == null || pick instanceof CommandQuickPickItem) return;

				args.branch = pick.ref;
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenInRemote, {
				resource: {
					type: RemoteResourceType.Branch,
					branch: args.branch || 'HEAD',
				},
				repoPath: repoPath,
				remote: args.remote,
				clipboard: args.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenBranchOnRemoteCommand');
			void window.showErrorMessage(
				'Unable to open branch on remote provider. See output channel for more details',
			);
		}
	}
}
