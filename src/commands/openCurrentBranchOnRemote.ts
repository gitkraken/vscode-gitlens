import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

@command()
export class OpenCurrentBranchOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.OpenCurrentBranchOnRemote);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repository = await getBestRepositoryOrShowPicker(gitUri, editor, 'Open Current Branch Name');
		if (repository == null) return;

		try {
			const branch = await repository.getBranch();
			if (branch?.name) {
				void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
					resource: {
						type: RemoteResourceType.Branch,
						branch: branch.name || 'HEAD',
					},
					repoPath: repository.path,
				}));
			}
		} catch (ex) {
			Logger.error(ex, 'OpenCurrentBranchOnRemoteCommand');
			void showGenericErrorMessage('Unable to open branch on remote provider');
		}
	}
}
