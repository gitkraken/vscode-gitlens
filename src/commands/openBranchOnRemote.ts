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
	remote?: string;
}

@command()
export class OpenBranchOnRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenBranchInRemote);
	}

	protected preExecute(context: CommandContext, args?: OpenBranchOnRemoteCommandArgs) {
		if (isCommandViewContextWithBranch(context)) {
			args = { ...args };
			args.branch = context.node.branch.name;
			args.remote = context.node.branch.getRemoteName();
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenBranchOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri && (await GitUri.fromUri(uri));

		const repoPath = await getRepoPathOrActiveOrPrompt(gitUri, editor, 'Open Branch On Remote');
		if (!repoPath) return;

		args = { ...args };

		try {
			if (args.branch == null) {
				const pick = await ReferencePicker.show(repoPath, 'Open Branch On Remote', 'Choose a branch to open', {
					autoPick: true,
					// checkmarks: false,
					filterBranches: b => b.tracking != null,
					include: ReferencesQuickPickIncludes.Branches,
				});
				if (pick == null || pick instanceof CommandQuickPickItem) return;

				args.branch = pick.ref;
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: RemoteResourceType.Branch,
					branch: args.branch || 'HEAD',
				},
				repoPath: repoPath,
				remote: args.remote,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenBranchOnRemoteCommand');
			void window.showErrorMessage(
				'Unable to open branch on remote provider. See output channel for more details',
			);
		}
	}
}
