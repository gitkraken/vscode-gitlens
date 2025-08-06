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

export interface OpenRepoOnRemoteCommandArgs {
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenRepoOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.openRepoOnRemote', 'gitlens.copyRemoteRepositoryUrl'], ['gitlens.openRepoInRemote']);
	}

	protected override preExecute(context: CommandContext, args?: OpenRepoOnRemoteCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasRemote(context)) {
			args = { ...args, remote: context.node.remote.name };
		}

		if (context.command === 'gitlens.copyRemoteRepositoryUrl') {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenRepoOnRemoteCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await getBestRepositoryOrShowPicker(
				this.container,
				gitUri,
				editor,
				args?.clipboard
					? 'Choose which repository to copy the url from'
					: 'Choose which repository to open on remote',
			)
		)?.path;
		if (!repoPath) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
				resource: {
					type: RemoteResourceType.Repo,
				},
				repoPath: repoPath,
				remote: args?.remote,
				clipboard: args?.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenRepoOnRemoteCommand');
			void showGenericErrorMessage('Unable to open repository on remote provider');
		}
	}
}
