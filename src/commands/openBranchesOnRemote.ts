import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasRemote } from './commandContext.utils';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenBranchesOnRemoteCommandArgs {
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenBranchesOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.openBranchesOnRemote', 'gitlens.copyRemoteBranchesUrl'], ['gitlens.openBranchesInRemote']);
	}

	protected override preExecute(context: CommandContext, args?: OpenBranchesOnRemoteCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name };
		}

		if (context.command === 'gitlens.copyRemoteBranchesUrl') {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenBranchesOnRemoteCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await getBestRepositoryOrShowPicker(
				this.container,
				gitUri,
				editor,
				args?.clipboard ? 'Copy Remote Branches URL' : 'Open Branches on Remote',
			)
		)?.path;
		if (!repoPath) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
				resource: {
					type: RemoteResourceType.Branches,
				},
				repoPath: repoPath,
				remote: args?.remote,
				clipboard: args?.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenBranchesOnRemoteCommand');
			void showGenericErrorMessage('Unable to open branches on remote provider');
		}
	}
}
